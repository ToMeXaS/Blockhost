import { describe, expect, it, vi } from 'vitest'
import type { ServerRecord, ServerStatus } from '../../shared/types'
import { BackupScheduler, isDue } from './scheduler'

const HOUR = 3_600_000
const rec = (id: string, intervalHours: number | null): ServerRecord =>
  ({ id, backup: { intervalHours, keep: 10 } }) as ServerRecord

describe('isDue', () => {
  const now = 10 * HOUR
  it('is never due when automatic backups are off', () => {
    expect(isDue(rec('a', null), 'running', false, null, now)).toBe(false)
    expect(isDue({ id: 'a' } as ServerRecord, 'running', false, null, now)).toBe(false)
  })
  it('only runs while the server is running and not busy', () => {
    expect(isDue(rec('a', 1), 'stopped', false, null, now)).toBe(false)
    expect(isDue(rec('a', 1), 'starting', false, null, now)).toBe(false)
    expect(isDue(rec('a', 1), 'running', true, null, now)).toBe(false)
  })
  it('is due with no previous backup, or once the interval has passed', () => {
    expect(isDue(rec('a', 6), 'running', false, null, now)).toBe(true)
    expect(isDue(rec('a', 6), 'running', false, now - 5 * HOUR, now)).toBe(false)
    expect(isDue(rec('a', 6), 'running', false, now - 6 * HOUR, now)).toBe(true)
  })
})

describe('BackupScheduler.tick', () => {
  function setup(servers: ServerRecord[], latest: Record<string, number | null>) {
    let now = 10 * HOUR
    const statuses: Record<string, ServerStatus> = {}
    const backup = vi.fn(async (_id: string) => {})
    const scheduler = new BackupScheduler({
      servers: () => servers,
      status: (id) => statuses[id] ?? 'running',
      isBusy: () => false,
      latestAutoAt: async (id) => latest[id] ?? null,
      backup,
      now: () => now
    })
    return { scheduler, backup, statuses, setNow: (t: number) => (now = t) }
  }

  it('backs up due servers one by one', async () => {
    const { scheduler, backup } = setup([rec('a', 1), rec('b', 1), rec('c', 24)], {
      a: 0,
      b: 10 * HOUR,
      c: 0
    })
    await scheduler.tick()
    expect(backup.mock.calls.map((c) => c[0])).toEqual(['a'])
  })

  it('waits a full interval after a failed attempt', async () => {
    const { scheduler, backup, setNow } = setup([rec('a', 1)], { a: null })
    backup.mockRejectedValueOnce(new Error('disk full'))
    await scheduler.tick()
    setNow(10 * HOUR + 60_000)
    await scheduler.tick()
    expect(backup).toHaveBeenCalledTimes(1)
    setNow(11 * HOUR)
    await scheduler.tick()
    expect(backup).toHaveBeenCalledTimes(2)
  })

  it('skips a server whose lookup throws without stopping the others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let now = 10 * HOUR
    const backup = vi.fn(async (_id: string) => {})
    const latestAutoAt = vi.fn(async (id: string) => {
      if (id === 'a') throw new Error('unreadable')
      return null
    })
    const scheduler = new BackupScheduler({
      servers: () => [rec('a', 1), rec('b', 1)],
      status: () => 'running',
      isBusy: () => false,
      latestAutoAt,
      backup,
      now: () => now
    })
    await expect(scheduler.tick()).resolves.toBeUndefined()
    expect(backup.mock.calls.map((c) => c[0])).toEqual(['b'])
    expect(warn).toHaveBeenCalledWith('[backups] scheduler skipped', 'a', expect.any(Error))

    now += 60_000
    await scheduler.tick()
    expect(latestAutoAt.mock.calls.filter((c) => c[0] === 'a')).toHaveLength(1)

    now = 11 * HOUR
    await scheduler.tick()
    expect(latestAutoAt.mock.calls.filter((c) => c[0] === 'a')).toHaveLength(2)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('never rejects when listing servers throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scheduler = new BackupScheduler({
      servers: () => {
        throw new Error('store unreadable')
      },
      status: () => 'running',
      isBusy: () => false,
      latestAutoAt: async () => null,
      backup: async () => {}
    })
    await expect(scheduler.tick()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('[backups] scheduler skipped', 'servers', expect.any(Error))
    warn.mockRestore()
  })

  it('does not overlap ticks', async () => {
    const { scheduler, backup } = setup([rec('a', 1)], { a: null })
    let release = () => {}
    backup.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    const first = scheduler.tick()
    await scheduler.tick()
    release()
    await first
    expect(backup).toHaveBeenCalledTimes(1)
  })
})

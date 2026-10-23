import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerRecord, StatsSampleEvent } from '../../shared/types'
import { AppError } from '../errors'
import { StatsService } from './service'
import { isTpsReply } from './tps'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const GB = 1024 ** 3

function setup(rec: Partial<ServerRecord> = {}) {
  const record = { id: ID, type: 'paper', mcVersion: '1.21.4', ramMb: 4096, ...rec } as ServerRecord
  let clock = 0
  const processes = {
    pid: vi.fn((): number | undefined => 4242),
    sendQuietCommand: vi.fn()
  }
  const sampler = { track: vi.fn(), untrack: vi.fn(), dispose: vi.fn(), available: true }
  const events: StatsSampleEvent[] = []
  const service = new StatsService({
    store: { get: () => record },
    processes,
    sampler,
    emit: (e) => events.push(e),
    cores: 4,
    now: () => clock
  })
  const setClock = (t: number) => {
    clock = t
  }
  return { processes, sampler, events, service, setClock }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('StatsService', () => {
  it('tracks the Java process when the server is running', () => {
    const { service, sampler } = setup()
    service.onStatus({ serverId: ID, status: 'starting' })
    expect(sampler.track).not.toHaveBeenCalled()
    service.onStatus({ serverId: ID, status: 'running' })
    service.onStatus({ serverId: ID, status: 'running' })
    expect(sampler.track).toHaveBeenCalledTimes(1)
    expect(sampler.track).toHaveBeenCalledWith(4242)
  })

  it('emits a point every 5 s with CPU % from the change in CPU time', () => {
    const { service, events, setClock } = setup()
    service.onStatus({ serverId: ID, status: 'running' })
    service.onSample({ pid: 4242, cpuMs: 1000, bytes: 2 * GB, at: 1000 })
    service.onSample({ pid: 4242, cpuMs: 7000, bytes: 3 * GB, at: 4000 })
    setClock(5000)
    vi.advanceTimersByTime(5000)
    expect(events).toEqual([
      {
        serverId: ID,
        samplerAvailable: true,
        point: { at: 5000, cpu: 50, memBytes: 3 * GB, tps: null }
      }
    ])
  })

  it('has no CPU % for the first sample but does report memory', () => {
    const { service, events, setClock } = setup()
    service.onStatus({ serverId: ID, status: 'running' })
    service.onSample({ pid: 4242, cpuMs: 1000, bytes: GB, at: 4000 })
    setClock(5000)
    vi.advanceTimersByTime(5000)
    expect(events[0].point).toEqual({ at: 5000, cpu: null, memBytes: GB, tps: null })
  })

  it('drops CPU and memory when the last sample is stale', () => {
    const { service, events, setClock } = setup()
    service.onStatus({ serverId: ID, status: 'running' })
    service.onSample({ pid: 4242, cpuMs: 1000, bytes: GB, at: 0 })
    setClock(15_000)
    vi.advanceTimersByTime(15_000)
    expect(events.at(-1)!.point).toEqual({ at: 15_000, cpu: null, memBytes: null, tps: null })
  })

  it('ignores samples for processes it does not know', () => {
    const { service, events, setClock } = setup()
    service.onStatus({ serverId: ID, status: 'running' })
    service.onSample({ pid: 1, cpuMs: 1000, bytes: GB, at: 4000 })
    setClock(5000)
    vi.advanceTimersByTime(5000)
    expect(events[0].point.memBytes).toBeNull()
  })

  it('polls TPS quietly right away and every 15 s on Paper', () => {
    const { service, processes } = setup()
    service.onStatus({ serverId: ID, status: 'running' })
    expect(processes.sendQuietCommand).toHaveBeenCalledWith(ID, 'tps', isTpsReply)
    vi.advanceTimersByTime(15_000)
    expect(processes.sendQuietCommand).toHaveBeenCalledTimes(2)
  })

  it('uses "tick query" on modern vanilla and nothing on old versions', () => {
    const modern = setup({ type: 'vanilla', mcVersion: '1.21.4' })
    modern.service.onStatus({ serverId: ID, status: 'running' })
    expect(modern.processes.sendQuietCommand).toHaveBeenCalledWith(ID, 'tick query', isTpsReply)

    const old = setup({ type: 'vanilla', mcVersion: '1.20.1' })
    old.service.onStatus({ serverId: ID, status: 'running' })
    expect(old.processes.sendQuietCommand).not.toHaveBeenCalled()
    expect(old.service.snapshot(ID).tpsSupported).toBe(false)
  })

  it('puts the latest TPS reply into the next point', () => {
    const { service, events, setClock } = setup()
    service.onStatus({ serverId: ID, status: 'running' })
    service.onQuietLine(ID, '[12:00:00 INFO]: TPS from last 1m, 5m, 15m: 19.5, 20.0, 20.0')
    service.onQuietLine(ID, '[12:00:00 INFO]: Unknown command. Type "/help" for help.')
    setClock(5000)
    vi.advanceTimersByTime(5000)
    expect(events[0].point.tps).toBe(19.5)
  })

  it('swallows a quiet-command failure from a server that just stopped', () => {
    const { service, processes } = setup()
    processes.sendQuietCommand.mockImplementation(() => {
      throw new AppError('NOT_RUNNING', 'The server is not running')
    })
    expect(() => service.onStatus({ serverId: ID, status: 'running' })).not.toThrow()
    expect(() => vi.advanceTimersByTime(15_000)).not.toThrow()
  })

  it('stops TPS polling while stopping but keeps emitting points', () => {
    const { service, processes, events } = setup()
    service.onStatus({ serverId: ID, status: 'running' })
    service.onStatus({ serverId: ID, status: 'stopping' })
    vi.advanceTimersByTime(15_000)
    expect(processes.sendQuietCommand).toHaveBeenCalledTimes(1)
    expect(events).toHaveLength(3)
  })

  it.each(['stopped', 'crashed'] as const)('cleans up when %s', (status) => {
    const { service, sampler, events } = setup()
    service.onStatus({ serverId: ID, status: 'running' })
    vi.advanceTimersByTime(5000)
    service.onStatus({ serverId: ID, status })
    expect(sampler.untrack).toHaveBeenCalledWith(4242)
    vi.advanceTimersByTime(30_000)
    expect(events).toHaveLength(1)
    expect(service.snapshot(ID).points).toEqual([])
  })

  it('snapshots history and server facts', () => {
    const { service, setClock } = setup()
    service.onStatus({ serverId: ID, status: 'running' })
    setClock(5000)
    vi.advanceTimersByTime(5000)
    expect(service.snapshot(ID)).toEqual({
      points: [{ at: 5000, cpu: null, memBytes: null, tps: null }],
      allocatedMb: 4096,
      cores: 4,
      tpsSupported: true,
      samplerAvailable: true
    })
  })

  it('keeps emitting points without a process id', () => {
    const { service, processes, sampler, events } = setup()
    processes.pid.mockReturnValue(undefined)
    service.onStatus({ serverId: ID, status: 'running' })
    vi.advanceTimersByTime(5000)
    expect(sampler.track).not.toHaveBeenCalled()
    expect(events).toHaveLength(1)
  })

  it('dispose stops timers and the sampler', () => {
    const { service, sampler, events } = setup()
    service.onStatus({ serverId: ID, status: 'running' })
    service.dispose()
    vi.advanceTimersByTime(30_000)
    expect(events).toHaveLength(0)
    expect(sampler.dispose).toHaveBeenCalled()
  })
})

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlayerAction, ServerRecord, ServerStatus } from '../../shared/types'
import { AppError } from '../errors'
import { readPropertiesFile } from '../servers/properties'
import { tempDir } from '../test-utils'
import { PlayerService, toCommand, type WatchFn } from './service'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = new Date('2026-10-18T14:03:00Z')

async function setup(status: ServerStatus = 'stopped') {
  const dir = join(await tempDir(), 'srv')
  await mkdir(dir)
  const rec = { id: ID, dir } as ServerRecord
  const processes = {
    status: vi.fn((): ServerStatus => status),
    sendCommand: vi.fn()
  }
  const lookup = vi.fn(async (name: string) => ({ uuid: `uuid-${name.toLowerCase()}`, name }))
  const watchers: { dir: string; onChange: (f: string | null) => void; close: () => void }[] = []
  const watch: WatchFn = (watchDir, onChange) => {
    const w = { dir: watchDir, onChange, close: vi.fn() }
    watchers.push(w)
    return w
  }
  const emit = vi.fn()
  const service = new PlayerService({
    store: { get: () => rec },
    processes,
    lookup,
    watch,
    emit,
    now: () => NOW,
    debounceMs: 500
  })
  const readJson = async (file: string) => JSON.parse(await readFile(join(dir, file), 'utf8'))
  return { dir, processes, lookup, watchers, emit, service, readJson }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('toCommand', () => {
  it('builds one console command per action', () => {
    const cases: [PlayerAction, string][] = [
      [{ type: 'op', name: 'Steve' }, 'op Steve'],
      [{ type: 'deop', name: 'Steve' }, 'deop Steve'],
      [{ type: 'whitelistAdd', name: 'Steve' }, 'whitelist add Steve'],
      [{ type: 'whitelistRemove', name: 'Steve' }, 'whitelist remove Steve'],
      [{ type: 'setWhitelistEnabled', enabled: true }, 'whitelist on'],
      [{ type: 'setWhitelistEnabled', enabled: false }, 'whitelist off'],
      [{ type: 'ban', name: 'Steve' }, 'ban Steve'],
      [{ type: 'ban', name: 'Steve', reason: '  Griefing  ' }, 'ban Steve Griefing'],
      [{ type: 'pardon', name: 'Steve' }, 'pardon Steve'],
      [{ type: 'banIp', ip: '203.0.113.7', reason: 'Alts' }, 'ban-ip 203.0.113.7 Alts'],
      [{ type: 'pardonIp', ip: '203.0.113.7' }, 'pardon-ip 203.0.113.7'],
      [{ type: 'kick', name: 'Steve', reason: 'AFK' }, 'kick Steve AFK'],
      [{ type: 'kick', name: 'Steve', reason: '' }, 'kick Steve']
    ]
    for (const [action, command] of cases) expect(toCommand(action)).toBe(command)
  })
})

describe('PlayerService while running', () => {
  it('schedules a resync emit 500ms after a running-path action even without a watcher event', async () => {
    vi.useFakeTimers()
    const { service, emit } = await setup('running')
    await service.action(ID, { type: 'op', name: 'Steve' })
    expect(emit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(499)
    expect(emit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(emit).toHaveBeenCalledWith({ serverId: ID })
  })

  it('sends the command and returns the current snapshot', async () => {
    const { service, processes, readJson, dir } = await setup('running')
    await writeFile(join(dir, 'ops.json'), '[]')
    const lists = await service.action(ID, { type: 'ban', name: 'Steve', reason: 'Griefing' })
    expect(processes.sendCommand).toHaveBeenCalledWith(ID, 'ban Steve Griefing')
    expect(lists.bannedPlayers).toEqual([])
    expect(await readJson('ops.json')).toEqual([])
  })

  it('kicks only while running', async () => {
    const running = await setup('running')
    await running.service.action(ID, { type: 'kick', name: 'Steve' })
    expect(running.processes.sendCommand).toHaveBeenCalledWith(ID, 'kick Steve')

    const stopped = await setup('stopped')
    await expect(stopped.service.action(ID, { type: 'kick', name: 'Steve' })).rejects.toMatchObject(
      { code: 'SERVER_NOT_RUNNING' }
    )
  })

  it('rejects actions while starting or stopping', async () => {
    for (const status of ['starting', 'stopping'] as const) {
      const { service, processes } = await setup(status)
      await expect(service.action(ID, { type: 'op', name: 'Steve' })).rejects.toMatchObject({
        code: 'SERVER_BUSY'
      })
      expect(processes.sendCommand).not.toHaveBeenCalled()
    }
  })
})

describe('PlayerService while stopped', () => {
  it('adds an op with the configured permission level', async () => {
    const { service, dir, lookup, readJson } = await setup()
    await writeFile(join(dir, 'server.properties'), 'op-permission-level=2\nonline-mode=false\n')
    const lists = await service.action(ID, { type: 'op', name: 'Steve' })
    expect(lookup).toHaveBeenCalledWith('Steve', false)
    expect(await readJson('ops.json')).toEqual([
      { uuid: 'uuid-steve', name: 'Steve', level: 2, bypassesPlayerLimit: false }
    ])
    expect(lists.ops).toEqual([{ uuid: 'uuid-steve', name: 'Steve', level: 2 }])
  })

  it('defaults to online mode and level 4', async () => {
    const { service, lookup, readJson } = await setup()
    await service.action(ID, { type: 'op', name: 'Steve' })
    expect(lookup).toHaveBeenCalledWith('Steve', true)
    expect((await readJson('ops.json'))[0].level).toBe(4)
  })

  it('treats adding an existing name as a no-op', async () => {
    const { service, dir, lookup } = await setup()
    await writeFile(join(dir, 'whitelist.json'), '[{"uuid":"u1","name":"Steve"}]')
    const lists = await service.action(ID, { type: 'whitelistAdd', name: 'steve' })
    expect(lookup).not.toHaveBeenCalled()
    expect(lists.whitelist).toEqual([{ uuid: 'u1', name: 'Steve' }])
  })

  it('removes by name case-insensitively and keeps other entries intact', async () => {
    const { service, dir, readJson } = await setup()
    await writeFile(
      join(dir, 'ops.json'),
      JSON.stringify([
        { uuid: 'u1', name: 'Steve', level: 4, bypassesPlayerLimit: true },
        { uuid: 'u2', name: 'Alex', level: 3, bypassesPlayerLimit: false, extra: 1 }
      ])
    )
    await service.action(ID, { type: 'deop', name: 'STEVE' })
    expect(await readJson('ops.json')).toEqual([
      { uuid: 'u2', name: 'Alex', level: 3, bypassesPlayerLimit: false, extra: 1 }
    ])
  })

  it('writes player and IP bans in the server format', async () => {
    const { service, readJson } = await setup()
    await service.action(ID, { type: 'ban', name: 'Steve' })
    await service.action(ID, { type: 'banIp', ip: '203.0.113.7', reason: 'Alts' })
    expect(await readJson('banned-players.json')).toEqual([
      {
        uuid: 'uuid-steve',
        name: 'Steve',
        created: '2026-10-18 14:03:00 +0000',
        source: 'Blockhost',
        expires: 'forever',
        reason: 'Banned by an operator.'
      }
    ])
    expect(await readJson('banned-ips.json')).toEqual([
      {
        ip: '203.0.113.7',
        created: '2026-10-18 14:03:00 +0000',
        source: 'Blockhost',
        expires: 'forever',
        reason: 'Alts'
      }
    ])

    await service.action(ID, { type: 'pardon', name: 'steve' })
    await service.action(ID, { type: 'pardonIp', ip: '203.0.113.7' })
    expect(await readJson('banned-players.json')).toEqual([])
    expect(await readJson('banned-ips.json')).toEqual([])
  })

  it('toggles the whitelist in server.properties', async () => {
    const { service, dir } = await setup()
    await writeFile(join(dir, 'server.properties'), 'motd=Hi\nwhite-list=false\n')
    const lists = await service.action(ID, { type: 'setWhitelistEnabled', enabled: true })
    expect(lists.whitelistEnabled).toBe(true)
    expect(await readPropertiesFile(dir)).toEqual([
      { key: 'motd', value: 'Hi' },
      { key: 'white-list', value: 'true' }
    ])
  })

  it('refuses to overwrite a corrupt list unless confirmed', async () => {
    const { service, dir, readJson } = await setup()
    await writeFile(join(dir, 'ops.json'), '[{oops')
    expect((await service.getPlayers(ID)).corrupt).toEqual(['ops'])
    await expect(service.action(ID, { type: 'op', name: 'Steve' })).rejects.toMatchObject({
      code: 'LIST_FILE_CORRUPT',
      details: { list: 'ops' }
    })
    await service.action(ID, { type: 'op', name: 'Steve', overwriteCorrupt: true })
    expect(await readJson('ops.json')).toHaveLength(1)
  })

  it('surfaces lookup failures without writing', async () => {
    const { service, lookup, dir } = await setup()
    lookup.mockRejectedValueOnce(new AppError('PLAYER_NOT_FOUND', 'No Minecraft account named Zzz'))
    await expect(service.action(ID, { type: 'whitelistAdd', name: 'Zzz' })).rejects.toMatchObject({
      code: 'PLAYER_NOT_FOUND'
    })
    await expect(readFile(join(dir, 'whitelist.json'), 'utf8')).rejects.toThrow()
  })

  it('blocks the write if the server starts while looking up the player, and leaves the file untouched', async () => {
    const { service, processes, lookup, dir, readJson } = await setup()
    await writeFile(join(dir, 'ops.json'), '[]')
    lookup.mockImplementation(async (name: string) => {
      processes.status.mockReturnValue('starting')
      return { uuid: `uuid-${name.toLowerCase()}`, name }
    })
    await expect(service.action(ID, { type: 'op', name: 'Steve' })).rejects.toMatchObject({
      code: 'SERVER_BUSY'
    })
    expect(await readJson('ops.json')).toEqual([])
  })

  it('serialises concurrent stopped-path edits instead of clobbering each other', async () => {
    const { service, readJson } = await setup()
    await Promise.all([
      service.action(ID, { type: 'op', name: 'Steve' }),
      service.action(ID, { type: 'op', name: 'Alex' })
    ])
    const ops = await readJson('ops.json')
    expect((ops as { name: string }[]).map((o) => o.name).sort()).toEqual(['Alex', 'Steve'])
  })
})

describe('PlayerService events', () => {
  it('tracks log lines while running', async () => {
    const { service, emit } = await setup('running')
    service.onLog({ serverId: ID, lines: ['[14:03:00 INFO]: Steve joined the game'] })
    expect(emit).toHaveBeenCalledWith({ serverId: ID })
    expect((await service.getPlayers(ID)).online).toEqual(['Steve'])
  })

  it('resyncs with `list` when a caller looks at a running server, throttled to once per 30s', async () => {
    const dir = join(await tempDir(), 'srv')
    await mkdir(dir)
    const rec = { id: ID, dir } as ServerRecord
    const processes = { status: vi.fn((): ServerStatus => 'running'), sendCommand: vi.fn() }
    let now = NOW
    const service = new PlayerService({
      store: { get: () => rec },
      processes,
      lookup: vi.fn(),
      watch: () => ({ close: vi.fn() }),
      emit: vi.fn(),
      now: () => now
    })

    await service.getPlayers(ID)
    expect(processes.sendCommand).toHaveBeenCalledTimes(1)
    expect(processes.sendCommand).toHaveBeenCalledWith(ID, 'list')

    await service.getPlayers(ID)
    expect(processes.sendCommand).toHaveBeenCalledTimes(1) // still within the 30s window

    now = new Date(now.getTime() + 30_000)
    await service.getPlayers(ID)
    expect(processes.sendCommand).toHaveBeenCalledTimes(2)
  })

  it('does not resync `list` when a caller looks at a server that is not running', async () => {
    const { service, processes } = await setup('stopped')
    await service.getPlayers(ID)
    expect(processes.sendCommand).not.toHaveBeenCalled()
  })

  it('reports no one online unless running', async () => {
    const { service, processes } = await setup('running')
    service.onLog({ serverId: ID, lines: ['[14:03:00 INFO]: Steve joined the game'] })
    processes.status.mockReturnValue('stopping')
    expect((await service.getPlayers(ID)).online).toEqual([])
  })

  it('watches list files while up, debounced, and stops on exit', async () => {
    vi.useFakeTimers()
    const { service, watchers, emit, dir } = await setup('running')
    service.onStatus({ serverId: ID, status: 'starting' })
    expect(watchers).toHaveLength(1)
    expect(watchers[0].dir).toBe(dir)

    watchers[0].onChange('ops.json')
    watchers[0].onChange('ops.json')
    watchers[0].onChange('world') // ignored
    vi.advanceTimersByTime(499)
    expect(emit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(emit).toHaveBeenCalledTimes(1)

    service.onStatus({ serverId: ID, status: 'running' })
    expect(watchers).toHaveLength(1) // not watched twice

    watchers[0].onChange(null)
    service.onStatus({ serverId: ID, status: 'stopped' })
    expect(watchers[0].close).toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(emit).toHaveBeenCalledTimes(1) // pending debounce was cancelled
  })

  it('clears the online set when the server stops', async () => {
    const { service, processes } = await setup('running')
    service.onLog({ serverId: ID, lines: ['[14:03:00 INFO]: Steve joined the game'] })
    service.onStatus({ serverId: ID, status: 'crashed' })
    expect((await service.getPlayers(ID)).online).toEqual([])
    processes.status.mockReturnValue('running')
    expect((await service.getPlayers(ID)).online).toEqual([])
  })

  it('keeps going if `list` cannot be sent', async () => {
    const { service, processes } = await setup('running')
    processes.sendCommand.mockImplementation(() => {
      throw new AppError('NOT_RUNNING', 'The server is not running')
    })
    await expect(service.getPlayers(ID)).resolves.toBeDefined()
  })
})

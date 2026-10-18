import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChildLike } from '../servers/process'
import {
  AgentProcess,
  classifyLine,
  PLAYITD_PIPE,
  playitdArgs,
  UNLINKED_MESSAGE,
  type AgentEvent
} from './agent'

class FakeChild extends EventEmitter {
  pid = 777
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()

  exit(code: number): void {
    this.stdout.end()
    this.stderr.end()
    this.emit('close', code)
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function setup() {
  const children: FakeChild[] = []
  const spawn = vi.fn((_cmd: string, _args: string[], _cwd: string) => {
    const child = new FakeChild()
    children.push(child)
    return child as unknown as ChildLike
  })
  const kill = vi.fn(async () => {
    children.at(-1)?.exit(1)
  })
  const events: AgentEvent[] = []
  const agent = new AgentProcess({
    spawn,
    kill,
    exe: async () => 'C:/data/playit/playitd-1.0.12.exe',
    secretPath: 'C:/data/playit/playit.toml',
    onEvent: (e) => events.push(e)
  })
  return { spawn, kill, children, events, agent }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('playitdArgs', () => {
  it('passes the secret file and a private pipe', () => {
    expect(playitdArgs('C:/s.toml')).toEqual([
      '--secret-path',
      'C:/s.toml',
      '--socket-path',
      PLAYITD_PIPE
    ])
    expect(PLAYITD_PIPE).toBe('\\\\.\\pipe\\blockhost-playitd')
  })
})

describe('classifyLine', () => {
  it('recognises connection, errors and an invalid key', () => {
    expect(
      classifyLine(
        '2026-10-18T14:03:00Z  INFO playitd::daemon: playit connected; tunnels loaded tunnel_count=1'
      )
    ).toEqual({ state: 'connected' })
    expect(
      classifyLine(
        '\u001b[31mERROR\u001b[0m playitd: Could not connect to playit tunnel servers. Check your internet connection, firewall, VPN, or DNS settings, then restart playit.'
      )
    ).toEqual({
      state: 'error',
      message:
        'Could not connect to playit tunnel servers. Check your internet connection, firewall, VPN, or DNS settings, then restart playit.'
    })
    expect(
      classifyLine(
        'ERROR The configured playit secret is no longer valid. Run `playit setup` to provision a new secret.'
      )
    ).toEqual({ state: 'error', unauthorized: true, message: UNLINKED_MESSAGE })
    expect(classifyLine('INFO something else')).toBeNull()
  })
})

describe('AgentProcess', () => {
  it('spawns playitd and reports connection from its log', async () => {
    const { agent, spawn, children, events } = setup()
    await agent.start()
    expect(spawn).toHaveBeenCalledWith(
      'C:/data/playit/playitd-1.0.12.exe',
      ['--secret-path', 'C:/data/playit/playit.toml', '--socket-path', PLAYITD_PIPE],
      'C:/data/playit'
    )
    children[0].stderr.write('INFO playit connected; tunnels loaded\n')
    await flush()
    expect(events.map((e) => e.state)).toEqual(['starting', 'connected'])
    expect(agent.state()).toBe('connected')
  })

  it('does not spawn twice', async () => {
    const { agent, spawn } = setup()
    await agent.start()
    await agent.start()
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('restarts after 2, 5 and 15 seconds, then gives up', async () => {
    vi.useFakeTimers()
    const { agent, spawn, children, events } = setup()
    await agent.start()
    for (const delay of [2000, 5000, 15000]) {
      children.at(-1)!.exit(1)
      await vi.advanceTimersByTimeAsync(delay - 1)
      const before = spawn.mock.calls.length
      await vi.advanceTimersByTimeAsync(1)
      expect(spawn.mock.calls.length).toBe(before + 1)
    }
    children.at(-1)!.exit(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(spawn).toHaveBeenCalledTimes(4)
    expect(events.at(-1)).toMatchObject({
      state: 'error',
      message: expect.stringContaining('Retry')
    })
  })

  it('resets the restart count after a successful connection', async () => {
    vi.useFakeTimers()
    const { agent, spawn, children } = setup()
    await agent.start()
    children[0].exit(1)
    await vi.advanceTimersByTimeAsync(2000)
    children[1].stderr.write('playit connected; tunnels loaded\n')
    await flush()
    children[1].exit(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(spawn).toHaveBeenCalledTimes(3)
  })

  it('stops without restarting', async () => {
    vi.useFakeTimers()
    const { agent, kill, spawn, events } = setup()
    await agent.start()
    agent.stop()
    expect(kill).toHaveBeenCalledWith(777)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toEqual({ state: 'stopped' })
  })

  it('stops itself when the key is rejected', async () => {
    const { agent, kill, children, events } = setup()
    await agent.start()
    children[0].stderr.write('ERROR The configured playit secret is no longer valid.\n')
    await flush()
    expect(events).toContainEqual({ state: 'error', unauthorized: true, message: UNLINKED_MESSAGE })
    expect(kill).toHaveBeenCalled()
  })

  it('retry starts again after giving up', async () => {
    vi.useFakeTimers()
    const { agent, spawn, children } = setup()
    await agent.start()
    for (const delay of [2000, 5000, 15000]) {
      children.at(-1)!.exit(1)
      await vi.advanceTimersByTimeAsync(delay)
    }
    children.at(-1)!.exit(1)
    await vi.advanceTimersByTimeAsync(60_000)
    await agent.retry()
    expect(spawn).toHaveBeenCalledTimes(5)
  })

  it('reports a failure to prepare the executable', async () => {
    const events: AgentEvent[] = []
    const agent = new AgentProcess({
      spawn: vi.fn(),
      kill: vi.fn(async () => {}),
      exe: async () => {
        throw new Error('Checksum mismatch for playitd-1.0.12.exe')
      },
      secretPath: 'C:/s.toml',
      onEvent: (e) => events.push(e)
    })
    await agent.start()
    expect(events.at(-1)).toEqual({
      state: 'error',
      message: 'Checksum mismatch for playitd-1.0.12.exe'
    })
  })

  it('stays stopped when stop() races a failing exe()', async () => {
    const spawn = vi.fn()
    const kill = vi.fn(async () => {})
    const events: AgentEvent[] = []
    let rejectExe: (err: Error) => void = () => {}
    const agent = new AgentProcess({
      spawn,
      kill,
      exe: () => new Promise((_resolve, reject) => (rejectExe = reject)),
      secretPath: 'C:/data/playit/playit.toml',
      onEvent: (e) => events.push(e)
    })
    const started = agent.start()
    await flush()
    agent.stop()
    rejectExe(new Error('network error'))
    await started
    await flush()
    expect(spawn).not.toHaveBeenCalled()
    expect(events.at(-1)).toEqual({ state: 'stopped' })
  })

  it('stays stopped when stop() races a succeeding exe()', async () => {
    const spawn = vi.fn()
    const kill = vi.fn(async () => {})
    const events: AgentEvent[] = []
    let resolveExe: (exe: string) => void = () => {}
    const agent = new AgentProcess({
      spawn,
      kill,
      exe: () => new Promise((resolve) => (resolveExe = resolve)),
      secretPath: 'C:/data/playit/playit.toml',
      onEvent: (e) => events.push(e)
    })
    const started = agent.start()
    await flush()
    agent.stop()
    resolveExe('C:/data/playit/playitd-1.0.12.exe')
    await started
    await flush()
    expect(spawn).not.toHaveBeenCalled()
    expect(events.at(-1)).toEqual({ state: 'stopped' })
    expect(events.filter((e) => e.state === 'stopped')).toHaveLength(1)
  })

  it('spawns once when stop() and start() overlap a restart that is preparing the exe', async () => {
    vi.useFakeTimers()
    const children: FakeChild[] = []
    let nextPid = 100
    const spawn = vi.fn(() => {
      const child = new FakeChild()
      child.pid = nextPid++
      children.push(child)
      return child as unknown as ChildLike
    })
    const kill = vi.fn(async () => {})
    const events: AgentEvent[] = []
    const pending: ((exe: string) => void)[] = []
    const agent = new AgentProcess({
      spawn,
      kill,
      exe: () => new Promise<string>((resolve) => pending.push(resolve)),
      secretPath: 'C:/data/playit/playit.toml',
      onEvent: (e) => events.push(e)
    })
    const first = agent.start()
    pending.shift()!('C:/playitd.exe')
    await first
    expect(spawn).toHaveBeenCalledTimes(1)

    children[0].exit(1)
    await vi.advanceTimersByTimeAsync(2000) // restart timer fires; launch awaits exe()
    expect(pending).toHaveLength(1)
    agent.stop()
    const restarted = agent.start()
    await flush()
    for (const resolve of pending.splice(0)) resolve('C:/playitd.exe')
    await flush()
    for (const resolve of pending.splice(0)) resolve('C:/playitd.exe')
    await restarted
    await flush()

    expect(spawn).toHaveBeenCalledTimes(2)
    expect(agent.state()).toBe('starting')
    agent.stop()
    expect(kill).toHaveBeenLastCalledWith(children[1].pid)
  })

  it('stays stopped when stop() races a scheduled restart', async () => {
    vi.useFakeTimers()
    const { agent, spawn, children, events } = setup()
    await agent.start()
    children.at(-1)!.exit(1)
    await vi.advanceTimersByTimeAsync(1000)
    agent.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toEqual({ state: 'stopped' })
  })
})

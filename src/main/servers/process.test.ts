import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { ServerLogEvent, ServerRecord, ServerStatus } from '../../shared/types'
import {
  buildJavaArgs,
  DONE_PATTERN,
  ProcessManager,
  type ChildLike,
  type ProcessManagerDeps
} from './process'

class FakeChild extends EventEmitter {
  pid = 4242
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  written: string[] = []

  constructor() {
    super()
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', (d: string) => this.written.push(d))
  }

  exit(code: number): void {
    this.stdout.end()
    this.stderr.end()
    this.emit('close', code)
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const rec: ServerRecord = {
  id: 's1',
  name: 'Survival',
  type: 'paper',
  mcVersion: '26.3',
  dir: 'C:/servers/s1',
  ramMb: 4096,
  port: 25565,
  jvmArgs: ['-XX:+UseG1GC'],
  launch: { args: ['-jar', 'server.jar'] },
  installState: 'ready',
  createdAt: '2026-10-17T12:00:00.000Z'
}

function setup(extra: Partial<ProcessManagerDeps> = {}) {
  const child = new FakeChild()
  const spawn = vi.fn(
    (_cmd: string, _args: string[], _cwd: string) => child as unknown as ChildLike
  )
  const kill = vi.fn(async () => {})
  const statuses: ServerStatus[] = []
  const logs: ServerLogEvent[] = []
  const quietLines: { serverId: string; line: string }[] = []
  const manager = new ProcessManager({
    spawn,
    kill,
    onStatus: (e) => statuses.push(e.status),
    onLog: (e) => logs.push(e),
    onQuietLine: (serverId, line) => quietLines.push({ serverId, line }),
    batchMs: 0,
    ...extra
  })
  return { child, spawn, kill, statuses, logs, quietLines, manager }
}

describe('buildJavaArgs', () => {
  it('builds memory, encoding, extra and launch arguments', () => {
    expect(buildJavaArgs(rec)).toEqual([
      '-Xms2048M',
      '-Xmx4096M',
      '-Dstdout.encoding=UTF-8',
      '-Dstderr.encoding=UTF-8',
      '-XX:+UseG1GC',
      '-jar',
      'server.jar',
      'nogui'
    ])
  })

  it('throws NOT_INSTALLED without a launch spec', () => {
    expect(() => buildJavaArgs({ ...rec, launch: undefined })).toThrow(
      expect.objectContaining({ code: 'NOT_INSTALLED' })
    )
  })
})

describe('DONE_PATTERN', () => {
  it('matches Vanilla/Paper and Forge style done lines', () => {
    expect(DONE_PATTERN.test('[12:00:01 INFO]: Done (3.214s)! For help, type "help"')).toBe(true)
    expect(DONE_PATTERN.test('[Server thread/INFO]: Done (12,5s)! For help, type "help"')).toBe(
      true
    )
    expect(DONE_PATTERN.test('Preparing spawn area')).toBe(false)
  })
})

describe('ProcessManager', () => {
  it('spawns Java in the server folder and goes starting -> running', async () => {
    const { child, spawn, statuses, manager } = setup()
    manager.start(rec, 'C:/java/bin/java.exe')
    expect(spawn).toHaveBeenCalledWith('C:/java/bin/java.exe', buildJavaArgs(rec), 'C:/servers/s1')
    expect(manager.status('s1')).toBe('starting')
    child.stdout.write('\u001b[32m[12:00:01 INFO]: Done (3.2s)! For help, type "help"\u001b[0m\n')
    await tick()
    expect(manager.status('s1')).toBe('running')
    expect(statuses).toEqual(['starting', 'running'])
    expect(manager.getLog('s1').at(-1)).toBe('[12:00:01 INFO]: Done (3.2s)! For help, type "help"')
  })

  it('streams batched log lines', async () => {
    const { child, logs, manager } = setup()
    manager.start(rec, 'java')
    child.stdout.write('one\ntwo\n')
    child.stderr.write('three\n')
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(logs.flatMap((e) => e.lines)).toEqual(expect.arrayContaining(['one', 'two', 'three']))
    expect(logs.every((e) => e.serverId === 's1')).toBe(true)
  })

  it('sends commands to stdin and echoes them in the log', async () => {
    const { child, manager } = setup()
    manager.start(rec, 'java')
    manager.sendCommand('s1', 'say hi')
    await tick()
    expect(child.written.join('')).toBe('say hi\n')
    expect(manager.getLog('s1')).toContain('> say hi')
  })

  it('logs stdin errors instead of crashing', async () => {
    const { child, manager } = setup()
    manager.start(rec, 'java')
    child.stdin.emit('error', new Error('EPIPE'))
    await tick()
    expect(manager.getLog('s1')).toContain('[Blockhost] Could not write to the server: EPIPE')
  })

  it('rejects commands when not running', () => {
    const { manager } = setup()
    expect(() => manager.sendCommand('s1', 'list')).toThrow(
      expect.objectContaining({ code: 'NOT_RUNNING' })
    )
  })

  it('stops gracefully with "stop" and reports stopped', async () => {
    const { child, statuses, manager } = setup()
    manager.start(rec, 'java')
    manager.stop('s1')
    await tick()
    expect(child.written.join('')).toBe('stop\n')
    expect(manager.status('s1')).toBe('stopping')
    const exited = manager.waitForExit('s1', 1000)
    child.exit(0)
    expect(await exited).toBe(true)
    expect(manager.status('s1')).toBe('stopped')
    expect(statuses).toEqual(['starting', 'stopping', 'stopped'])
    expect(manager.isActive('s1')).toBe(false)
  })

  it('reports crashed on an unexpected exit', () => {
    const { child, manager } = setup()
    manager.start(rec, 'java')
    child.exit(1)
    expect(manager.status('s1')).toBe('crashed')
    expect(manager.getLog('s1').at(-1)).toContain('exited with code 1')
  })

  it('waitForExit times out while the process keeps running', async () => {
    const { manager } = setup()
    manager.start(rec, 'java')
    expect(await manager.waitForExit('s1', 10)).toBe(false)
  })

  it('kill force-kills the process tree', async () => {
    const { child, kill, manager } = setup()
    manager.start(rec, 'java')
    await manager.kill('s1')
    expect(kill).toHaveBeenCalledWith(4242)
    child.exit(1)
    expect(manager.status('s1')).toBe('stopped')
  })

  it('refuses to start twice and tracks active ids', () => {
    const { manager } = setup()
    manager.start(rec, 'java')
    expect(manager.activeIds()).toEqual(['s1'])
    expect(() => manager.start(rec, 'java')).toThrow(
      expect.objectContaining({ code: 'ALREADY_RUNNING' })
    )
  })

  it('keeps only the newest maxLogLines lines', async () => {
    const child = new FakeChild()
    const manager = new ProcessManager({
      spawn: () => child as unknown as ChildLike,
      kill: async () => {},
      onStatus: () => {},
      onLog: () => {},
      batchMs: 0,
      maxLogLines: 3
    })
    manager.start(rec, 'java')
    child.stdout.write('a\nb\nc\nd\ne\n')
    await tick()
    expect(manager.getLog('s1')).toEqual(['c', 'd', 'e'])
  })
})

describe('ProcessManager quiet commands', () => {
  const TPS_LINE = '[12:00:00 INFO]: TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0'
  const isTps = (line: string) => line.includes('TPS from')

  it('exposes the Java process id while running', () => {
    const { manager } = setup()
    expect(manager.pid('s1')).toBeUndefined()
    manager.start(rec, 'java')
    expect(manager.pid('s1')).toBe(4242)
  })

  it('writes the command without echoing it in the log', async () => {
    const { child, manager } = setup()
    manager.start(rec, 'java')
    manager.sendQuietCommand('s1', 'tps', isTps)
    await tick()
    expect(child.written.join('')).toBe('tps\n')
    expect(manager.getLog('s1')).not.toContain('> tps')
  })

  it('hides matching replies from the log and forwards them', async () => {
    const { child, logs, quietLines, manager } = setup()
    manager.start(rec, 'java')
    manager.sendQuietCommand('s1', 'tps', isTps)
    child.stdout.write(`${TPS_LINE}\n[12:00:00 INFO]: Steve joined the game\n`)
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(quietLines).toEqual([{ serverId: 's1', line: TPS_LINE }])
    expect(manager.getLog('s1')).toContain('[12:00:00 INFO]: Steve joined the game')
    expect(manager.getLog('s1')).not.toContain(TPS_LINE)
    expect(logs.flatMap((e) => e.lines)).not.toContain(TPS_LINE)
  })

  it('keeps hiding replies to every quiet command that is still waiting', async () => {
    const { child, quietLines, manager } = setup()
    const DIM_LINE = '[12:00:00 INFO]: Steve has the following entity data: "minecraft:overworld"'
    manager.start(rec, 'java')
    manager.sendQuietCommand('s1', 'data get entity Steve Dimension', (l) =>
      l.includes('Steve has')
    )
    manager.sendQuietCommand('s1', 'tps', isTps)
    child.stdout.write(`${DIM_LINE}\n${TPS_LINE}\n`)
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(quietLines.map((q) => q.line)).toEqual([DIM_LINE, TPS_LINE])
    expect(manager.getLog('s1')).not.toContain(DIM_LINE)
  })

  it('shows replies to a command the user types during a quiet window', async () => {
    const { child, quietLines, manager } = setup()
    manager.start(rec, 'java')
    manager.sendQuietCommand('s1', 'tps', isTps)
    manager.sendCommand('s1', 'tps')
    child.stdout.write(`${TPS_LINE}
`)
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(quietLines).toEqual([])
    expect(manager.getLog('s1')).toContain(TPS_LINE)
  })

  it('stops hiding once the quiet window has passed', async () => {
    const { child, quietLines, manager } = setup({ quietMs: 0 })
    manager.start(rec, 'java')
    manager.sendQuietCommand('s1', 'tps', isTps)
    child.stdout.write(`${TPS_LINE}\n`)
    await tick()
    expect(quietLines).toEqual([])
    expect(manager.getLog('s1')).toContain(TPS_LINE)
  })

  it('still detects the Done line while a quiet window is open', async () => {
    const { child, manager } = setup()
    manager.start(rec, 'java')
    manager.sendQuietCommand('s1', 'tps', () => true)
    child.stdout.write('[12:00:01 INFO]: Done (3.2s)! For help, type "help"\n')
    await tick()
    expect(manager.status('s1')).toBe('running')
  })

  it('rejects quiet commands when not running', () => {
    const { manager } = setup()
    expect(() => manager.sendQuietCommand('s1', 'tps', isTps)).toThrow(
      expect.objectContaining({ code: 'NOT_RUNNING' })
    )
  })
})

import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChildLike } from '../servers/process'
import { parseSampleLine, ProcessSampler, samplerArgs, type ProcessSample } from './sampler'

class FakeChild extends EventEmitter {
  pid = 900
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
    this.emit('close', code)
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function setup() {
  const children: FakeChild[] = []
  const spawn = vi.fn((_cmd: string, _args: string[], _cwd: string) => {
    const child = new FakeChild()
    children.push(child)
    return child as unknown as ChildLike
  })
  const samples: ProcessSample[] = []
  const sampler = new ProcessSampler({
    spawn,
    onSample: (s) => samples.push(s),
    now: () => 1234
  })
  return { children, spawn, samples, sampler }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('samplerArgs', () => {
  it('runs a hidden, profile-less PowerShell with an encoded script', () => {
    const args = samplerArgs(5000)
    expect(args.slice(0, -1)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand'
    ])
    const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le')
    expect(script).toContain('Get-Process -Id $ids')
    expect(script).toContain('Start-Sleep -Milliseconds 5000')
    expect(script).toContain('ReadLineAsync')
  })
})

describe('parseSampleLine', () => {
  it('parses a JSON sample line', () => {
    expect(parseSampleLine('{"pid":12,"cpuMs":3400,"bytes":1048576}', 99)).toEqual({
      pid: 12,
      cpuMs: 3400,
      bytes: 1048576,
      at: 99
    })
  })

  it.each(['', 'hello', '{"pid":"12","cpuMs":1,"bytes":1}', '{"pid":12}', '[1,2]'])(
    'ignores %j',
    (line) => {
      expect(parseSampleLine(line, 1)).toBeNull()
    }
  )
})

describe('ProcessSampler', () => {
  it('starts PowerShell on the first tracked PID and sends the PID list', async () => {
    const { children, spawn, sampler } = setup()
    expect(spawn).not.toHaveBeenCalled()
    sampler.track(123)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0][0]).toBe('powershell.exe')
    sampler.track(456)
    sampler.track(456)
    await tick()
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(children[0].written.join('')).toBe('123\n123 456\n')
  })

  it('reports parsed samples and ignores other output', async () => {
    const { children, samples, sampler } = setup()
    sampler.track(12)
    children[0].stdout.write('noise\r\n{"pid":12,"cpuMs":3400,"bytes":2048}\r\n')
    await tick()
    expect(samples).toEqual([{ pid: 12, cpuMs: 3400, bytes: 2048, at: 1234 }])
  })

  it('closes PowerShell when nothing is tracked and does not restart it', async () => {
    const { children, spawn, sampler } = setup()
    sampler.track(12)
    sampler.untrack(12)
    expect(children[0].stdin.writableEnded).toBe(true)
    children[0].exit(0)
    vi.advanceTimersByTime(10_000)
    expect(spawn).toHaveBeenCalledTimes(1)
    sampler.track(13)
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('restarts after a crash and gives up after 3 failures in a row', () => {
    const { children, spawn, sampler } = setup()
    sampler.track(12)
    children[0].exit(1)
    vi.advanceTimersByTime(2000)
    expect(spawn).toHaveBeenCalledTimes(2)
    children[1].exit(1)
    vi.advanceTimersByTime(2000)
    expect(spawn).toHaveBeenCalledTimes(3)
    expect(sampler.available).toBe(true)
    children[2].exit(1)
    vi.advanceTimersByTime(10_000)
    expect(spawn).toHaveBeenCalledTimes(3)
    expect(sampler.available).toBe(false)
  })

  it('a successful sample resets the failure count', async () => {
    const { children, spawn, sampler } = setup()
    sampler.track(12)
    children[0].exit(1)
    vi.advanceTimersByTime(2000)
    children[1].stdout.write('{"pid":12,"cpuMs":1,"bytes":1}\n')
    await tick()
    children[1].exit(1)
    vi.advanceTimersByTime(2000)
    children[2].exit(1)
    vi.advanceTimersByTime(2000)
    expect(spawn).toHaveBeenCalledTimes(4)
    expect(sampler.available).toBe(true)
  })

  it('dispose stops everything', () => {
    const { children, spawn, sampler } = setup()
    sampler.track(12)
    sampler.dispose()
    expect(children[0].stdin.writableEnded).toBe(true)
    children[0].exit(1)
    vi.advanceTimersByTime(10_000)
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})

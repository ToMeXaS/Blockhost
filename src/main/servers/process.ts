import { execFile, spawn } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import type {
  ServerLogEvent,
  ServerRecord,
  ServerStatus,
  ServerStatusEvent
} from '../../shared/types'
import { AppError } from '../errors'
import { stripAnsi } from '../util/ansi'
import { Batcher } from '../util/batcher'
import { LineSplitter } from '../util/lines'

export interface ChildLike {
  pid?: number
  stdout: Readable
  stderr: Readable
  stdin: Writable
  on(event: 'close', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
}

export type SpawnFn = (command: string, args: string[], cwd: string) => ChildLike

export const defaultSpawn: SpawnFn = (command, args, cwd) =>
  spawn(command, args, { cwd, windowsHide: true }) as ChildLike

export function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve())
  })
}

export const DONE_PATTERN = /Done \(\d+(?:[.,]\d+)?s\)!/

export function buildJavaArgs(rec: ServerRecord): string[] {
  if (!rec.launch) throw new AppError('NOT_INSTALLED', 'This server has not finished installing')
  return [
    `-Xms${Math.max(256, Math.floor(rec.ramMb / 2))}M`,
    `-Xmx${rec.ramMb}M`,
    '-Dstdout.encoding=UTF-8',
    '-Dstderr.encoding=UTF-8',
    ...rec.jvmArgs,
    ...rec.launch.args,
    'nogui'
  ]
}

export interface ProcessManagerDeps {
  spawn: SpawnFn
  kill: (pid: number) => Promise<void>
  onStatus: (event: ServerStatusEvent) => void
  onLog: (event: ServerLogEvent) => void
  /** Receives console lines hidden because they answer a quiet command. */
  onQuietLine?: (serverId: string, line: string) => void
  quietMs?: number
  batchMs?: number
  maxLogLines?: number
}

interface Entry {
  child: ChildLike | null
  status: ServerStatus
  log: string[]
  stopRequested: boolean
  exitWaiters: (() => void)[]
  batcher: Batcher<string>
  quiet: { until: number; isReply: (line: string) => boolean } | null
}

export class ProcessManager {
  private readonly deps: ProcessManagerDeps
  private readonly maxLogLines: number
  private readonly entries = new Map<string, Entry>()

  constructor(deps: ProcessManagerDeps) {
    this.deps = deps
    this.maxLogLines = deps.maxLogLines ?? 5000
  }

  status(id: string): ServerStatus {
    return this.entries.get(id)?.status ?? 'stopped'
  }

  isActive(id: string): boolean {
    return this.entries.get(id)?.child != null
  }

  activeIds(): string[] {
    return [...this.entries].filter(([, e]) => e.child).map(([id]) => id)
  }

  getLog(id: string): string[] {
    return (this.entries.get(id)?.log ?? []).slice(-this.maxLogLines)
  }

  start(rec: ServerRecord, javaPath: string): void {
    if (this.isActive(rec.id))
      throw new AppError('ALREADY_RUNNING', 'The server is already running')
    const args = buildJavaArgs(rec)
    const entry = this.entry(rec.id)
    entry.stopRequested = false
    entry.quiet = null
    this.append(rec.id, `[Blockhost] Starting: "${javaPath}" ${args.join(' ')}`)

    const child = this.deps.spawn(javaPath, args, rec.dir)
    entry.child = child
    this.setStatus(rec.id, 'starting')

    child.stdin.on('error', (err: Error) => {
      this.append(rec.id, `[Blockhost] Could not write to the server: ${err.message}`)
    })

    const onLine = (line: string): void => {
      const clean = stripAnsi(line)
      if (this.isQuietReply(entry, clean)) this.deps.onQuietLine?.(rec.id, clean)
      else this.append(rec.id, clean)
      if (entry.status === 'starting' && DONE_PATTERN.test(clean)) this.setStatus(rec.id, 'running')
    }
    const stdout = new LineSplitter(onLine)
    const stderr = new LineSplitter(onLine)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => stdout.push(chunk))
    child.stderr.on('data', (chunk: string) => stderr.push(chunk))

    let finished = false
    const finish = (message: string): void => {
      if (finished) return
      finished = true
      stdout.flush()
      stderr.flush()
      this.append(rec.id, message)
      entry.child = null
      this.setStatus(rec.id, entry.stopRequested ? 'stopped' : 'crashed')
      entry.batcher.flush()
      const waiters = entry.exitWaiters
      entry.exitWaiters = []
      for (const resolve of waiters) resolve()
    }
    child.on('close', (code) => finish(`[Blockhost] Server exited with code ${code}`))
    child.on('error', (err) => finish(`[Blockhost] Failed to start Java: ${err.message}`))
  }

  sendCommand(id: string, command: string): void {
    const child = this.entries.get(id)?.child
    if (!child) throw new AppError('NOT_RUNNING', 'The server is not running')
    this.append(id, `> ${command}`)
    child.stdin.write(`${command}\n`)
  }

  pid(id: string): number | undefined {
    return this.entries.get(id)?.child?.pid
  }

  /** Sends a command without echoing it, hiding reply lines for a short window. */
  sendQuietCommand(id: string, command: string, isReply: (line: string) => boolean): void {
    const entry = this.entries.get(id)
    if (!entry?.child) throw new AppError('NOT_RUNNING', 'The server is not running')
    entry.quiet = { until: Date.now() + (this.deps.quietMs ?? 3000), isReply }
    entry.child.stdin.write(`${command}\n`)
  }

  stop(id: string): void {
    const entry = this.entries.get(id)
    if (!entry?.child) return
    entry.stopRequested = true
    this.setStatus(id, 'stopping')
    entry.child.stdin.write('stop\n')
  }

  async kill(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry?.child) return
    entry.stopRequested = true
    if (entry.child.pid) await this.deps.kill(entry.child.pid)
  }

  waitForExit(id: string, timeoutMs: number): Promise<boolean> {
    const entry = this.entries.get(id)
    if (!entry?.child) return Promise.resolve(true)
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined = undefined
      const done = (): void => {
        clearTimeout(timer)
        resolve(true)
      }
      timer = setTimeout(() => {
        entry.exitWaiters = entry.exitWaiters.filter((w) => w !== done)
        resolve(false)
      }, timeoutMs)
      entry.exitWaiters.push(done)
    })
  }

  private isQuietReply(entry: Entry, line: string): boolean {
    const quiet = entry.quiet
    if (!quiet) return false
    if (Date.now() >= quiet.until) {
      entry.quiet = null
      return false
    }
    return quiet.isReply(line)
  }

  private entry(id: string): Entry {
    let entry = this.entries.get(id)
    if (!entry) {
      entry = {
        child: null,
        status: 'stopped',
        log: [],
        stopRequested: false,
        exitWaiters: [],
        batcher: new Batcher<string>(this.deps.batchMs ?? 50, (lines) =>
          this.deps.onLog({ serverId: id, lines })
        ),
        quiet: null
      }
      this.entries.set(id, entry)
    }
    return entry
  }

  private append(id: string, line: string): void {
    const entry = this.entry(id)
    entry.log.push(line)
    if (entry.log.length > this.maxLogLines)
      entry.log.splice(0, entry.log.length - this.maxLogLines)
    entry.batcher.push(line)
  }

  private setStatus(id: string, status: ServerStatus): void {
    const entry = this.entry(id)
    if (entry.status === status) return
    entry.status = status
    this.deps.onStatus({ serverId: id, status })
  }
}

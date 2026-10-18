import { dirname } from 'node:path'
import type { ChildLike, SpawnFn } from '../servers/process'
import { stripAnsi } from '../util/ansi'
import { LineSplitter } from '../util/lines'

export const PLAYITD_PIPE = '\\\\.\\pipe\\blockhost-playitd'
export const RESTART_DELAYS_MS = [2000, 5000, 15000]
export const UNLINKED_MESSAGE =
  'playit.gg no longer accepts the saved key. Link your playit.gg account again.'

const CONNECTED_MARKER = 'playit connected'
const UNAUTHORIZED_MARKERS = ['secret is no longer valid', 'Invalid secret file']
const ERROR_MARKERS = [
  'Could not connect to playit tunnel servers',
  'Could not reach the playit API',
  'The playit API rejected',
  'Timed out while connecting to playit',
  'Failed to start the playit agent'
]

export type AgentState = 'stopped' | 'starting' | 'connected' | 'error'

export interface AgentEvent {
  state: AgentState
  message?: string
  unauthorized?: boolean
}

export function playitdArgs(secretPath: string, socketPath: string = PLAYITD_PIPE): string[] {
  return ['--secret-path', secretPath, '--socket-path', socketPath]
}

export function classifyLine(line: string): AgentEvent | null {
  const text = stripAnsi(line)
  if (text.includes(CONNECTED_MARKER)) return { state: 'connected' }
  if (UNAUTHORIZED_MARKERS.some((m) => text.includes(m))) {
    return { state: 'error', unauthorized: true, message: UNLINKED_MESSAGE }
  }
  for (const marker of ERROR_MARKERS) {
    const index = text.indexOf(marker)
    if (index >= 0) return { state: 'error', message: text.slice(index).trim() }
  }
  return null
}

export interface AgentProcessDeps {
  spawn: SpawnFn
  kill: (pid: number) => Promise<void>
  exe: () => Promise<string>
  secretPath: string
  onEvent: (event: AgentEvent) => void
  delays?: number[]
}

/** Runs playitd as a child process and keeps it running until stopped. */
export class AgentProcess {
  private readonly deps: AgentProcessDeps
  private child: ChildLike | null = null
  private current: AgentState = 'stopped'
  private stopRequested = false
  private failures = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(deps: AgentProcessDeps) {
    this.deps = deps
  }

  state(): AgentState {
    return this.current
  }

  async start(): Promise<void> {
    if (this.child || this.timer) return
    this.stopRequested = false
    await this.launch()
  }

  async retry(): Promise<void> {
    this.failures = 0
    await this.start()
  }

  stop(): void {
    this.stopRequested = true
    clearTimeout(this.timer)
    this.timer = undefined
    const child = this.child
    if (child?.pid) {
      void this.deps.kill(child.pid)
    } else if (!child && this.current !== 'stopped') {
      this.emit({ state: 'stopped' })
    }
  }

  private emit(event: AgentEvent): void {
    this.current = event.state
    this.deps.onEvent(event)
  }

  private async launch(): Promise<void> {
    this.timer = undefined
    this.emit({ state: 'starting' })
    let exe: string
    try {
      exe = await this.deps.exe()
    } catch (err) {
      this.emit({ state: 'error', message: (err as Error).message })
      return
    }
    if (this.stopRequested) {
      this.emit({ state: 'stopped' })
      return
    }

    const child = this.deps.spawn(
      exe,
      playitdArgs(this.deps.secretPath),
      dirname(this.deps.secretPath)
    )
    this.child = child

    const onLine = (line: string): void => {
      const event = classifyLine(line)
      if (!event) return
      if (event.state === 'connected') this.failures = 0
      this.emit(event)
      if (event.unauthorized) this.stop()
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
      this.child = null
      if (this.stopRequested) {
        this.emit({ state: 'stopped' })
        return
      }
      this.scheduleRestart(message)
    }
    child.on('close', (code) => finish(`The playit agent stopped (exit code ${code}).`))
    child.on('error', (err) => finish(`Could not start the playit agent: ${err.message}`))
  }

  private scheduleRestart(message: string): void {
    const delays = this.deps.delays ?? RESTART_DELAYS_MS
    const delay = delays[this.failures]
    this.failures++
    if (delay === undefined) {
      this.emit({ state: 'error', message: `${message} Click Retry to try again.` })
      return
    }
    this.emit({ state: 'starting', message })
    this.timer = setTimeout(() => void this.launch(), delay)
  }
}

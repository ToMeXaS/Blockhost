import { tmpdir } from 'node:os'
import type { ChildLike, SpawnFn } from '../servers/process'
import { LineSplitter } from '../util/lines'

export interface ProcessSample {
  pid: number
  /** Total CPU time the process has used so far. */
  cpuMs: number
  /** Working set. */
  bytes: number
  at: number
}

export interface ProcessSamplerDeps {
  spawn: SpawnFn
  onSample: (sample: ProcessSample) => void
  intervalMs?: number
  restartDelayMs?: number
  maxFailures?: number
  now?: () => number
}

/** Reads PID lists from stdin without blocking, prints one JSON line per live PID, exits on EOF. */
export function samplerScript(intervalMs: number): string {
  return [
    '$ErrorActionPreference = "SilentlyContinue"',
    '$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput())',
    '$pending = $reader.ReadLineAsync()',
    '$ids = @()',
    'while ($true) {',
    '  while ($pending.IsCompleted) {',
    '    $line = $pending.Result',
    '    if ($null -eq $line) { exit }',
    '    $ids = @($line.Split(" ", [StringSplitOptions]::RemoveEmptyEntries) | ForEach-Object { [int]$_ })',
    '    $pending = $reader.ReadLineAsync()',
    '  }',
    '  if ($ids.Count -gt 0) {',
    '    foreach ($p in Get-Process -Id $ids) {',
    `      [Console]::Out.WriteLine('{"pid":' + $p.Id + ',"cpuMs":' + [long]$p.TotalProcessorTime.TotalMilliseconds + ',"bytes":' + $p.WorkingSet64 + '}')`,
    '    }',
    '    [Console]::Out.Flush()',
    '  }',
    `  Start-Sleep -Milliseconds ${intervalMs}`,
    '}'
  ].join('\n')
}

export function samplerArgs(intervalMs: number): string[] {
  const encoded = Buffer.from(samplerScript(intervalMs), 'utf16le').toString('base64')
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]
}

export function parseSampleLine(line: string, at: number): ProcessSample | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { pid, cpuMs, bytes } = value as Record<string, unknown>
  if (typeof pid !== 'number' || typeof cpuMs !== 'number' || typeof bytes !== 'number') return null
  if (![pid, cpuMs, bytes].every(Number.isFinite)) return null
  return { pid, cpuMs, bytes, at }
}

/** Samples CPU time and memory of tracked processes through one hidden PowerShell child. */
export class ProcessSampler {
  private readonly deps: ProcessSamplerDeps
  private readonly pids = new Set<number>()
  private child: ChildLike | null = null
  private restartTimer: ReturnType<typeof setTimeout> | undefined = undefined
  private failures = 0
  private gaveUp = false

  constructor(deps: ProcessSamplerDeps) {
    this.deps = deps
  }

  get available(): boolean {
    return !this.gaveUp
  }

  track(pid: number): void {
    if (this.pids.has(pid)) return
    this.pids.add(pid)
    this.sync()
  }

  untrack(pid: number): void {
    if (!this.pids.delete(pid)) return
    this.sync()
  }

  dispose(): void {
    this.pids.clear()
    this.shutdown()
  }

  private sync(): void {
    if (this.pids.size === 0) return this.shutdown()
    if (this.gaveUp) return
    if (this.child) return this.writePids()
    if (this.restartTimer === undefined) this.launch()
  }

  private launch(): void {
    const child = this.deps.spawn(
      'powershell.exe',
      samplerArgs(this.deps.intervalMs ?? 5000),
      tmpdir()
    )
    this.child = child
    const now = this.deps.now ?? Date.now
    const lines = new LineSplitter((line) => {
      const sample = parseSampleLine(line, now())
      if (!sample) return
      this.failures = 0
      this.deps.onSample(sample)
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => lines.push(chunk))
    child.stderr.resume()
    child.stdin.on('error', () => {})

    let exited = false
    const onExit = (): void => {
      if (exited) return
      exited = true
      if (this.child !== child) return
      this.child = null
      this.scheduleRestart()
    }
    child.on('close', onExit)
    child.on('error', onExit)
    this.writePids()
  }

  private writePids(): void {
    this.child?.stdin.write(`${[...this.pids].join(' ')}\n`)
  }

  private scheduleRestart(): void {
    if (this.pids.size === 0) return
    this.failures++
    if (this.failures >= (this.deps.maxFailures ?? 3)) {
      this.gaveUp = true
      return
    }
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      if (this.pids.size > 0 && !this.child) this.launch()
    }, this.deps.restartDelayMs ?? 2000)
  }

  private shutdown(): void {
    clearTimeout(this.restartTimer)
    this.restartTimer = undefined
    const child = this.child
    this.child = null
    child?.stdin.end()
  }
}

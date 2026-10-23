import { availableParallelism } from 'node:os'
import type {
  ServerStatusEvent,
  StatsPoint,
  StatsSampleEvent,
  StatsSnapshot
} from '../../shared/types'
import type { ProcessManager } from '../servers/process'
import type { ServerStore } from '../servers/store'
import { StatsHistory } from './history'
import type { ProcessSample, ProcessSampler } from './sampler'
import { isTpsReply, parseTps, tpsCommandFor } from './tps'

export const POINT_INTERVAL_MS = 5000
export const TPS_INTERVAL_MS = 15000

export interface StatsServiceDeps {
  store: Pick<ServerStore, 'get'>
  processes: Pick<ProcessManager, 'pid' | 'sendQuietCommand'>
  sampler: Pick<ProcessSampler, 'track' | 'untrack' | 'dispose' | 'available'>
  emit: (event: StatsSampleEvent) => void
  cores?: number
  now?: () => number
  pointIntervalMs?: number
  tpsIntervalMs?: number
}

interface Live {
  pid: number | undefined
  cpu: number | null
  memBytes: number | null
  sampledAt: number
  prev: { cpuMs: number; at: number } | null
  tps: number | null
  pointTimer: ReturnType<typeof setInterval>
  tpsTimer?: ReturnType<typeof setInterval>
}

const round1 = (n: number): number => Math.round(n * 10) / 10

export class StatsService {
  private readonly deps: StatsServiceDeps
  private readonly cores: number
  private readonly pointMs: number
  private readonly history = new StatsHistory()
  private readonly live = new Map<string, Live>()

  constructor(deps: StatsServiceDeps) {
    this.deps = deps
    this.cores = deps.cores ?? availableParallelism()
    this.pointMs = deps.pointIntervalMs ?? POINT_INTERVAL_MS
  }

  onStatus({ serverId, status }: ServerStatusEvent): void {
    if (status === 'running') this.begin(serverId)
    else if (status === 'stopping') this.stopTps(serverId)
    else if (status === 'stopped' || status === 'crashed') this.end(serverId)
  }

  onSample(sample: ProcessSample): void {
    for (const live of this.live.values()) {
      if (live.pid !== sample.pid) continue
      const prev = live.prev
      live.cpu =
        prev && sample.at > prev.at
          ? round1(
              Math.min(
                100,
                Math.max(
                  0,
                  ((sample.cpuMs - prev.cpuMs) / (sample.at - prev.at) / this.cores) * 100
                )
              )
            )
          : null
      live.prev = { cpuMs: sample.cpuMs, at: sample.at }
      live.memBytes = sample.bytes
      live.sampledAt = sample.at
      return
    }
  }

  onQuietLine(serverId: string, line: string): void {
    const live = this.live.get(serverId)
    const tps = parseTps(line)
    if (live && tps !== null) live.tps = round1(tps)
  }

  snapshot(serverId: string): StatsSnapshot {
    const rec = this.deps.store.get(serverId)
    return {
      points: this.history.points(serverId),
      allocatedMb: rec.ramMb,
      cores: this.cores,
      tpsSupported: tpsCommandFor(rec.type, rec.mcVersion) !== null,
      samplerAvailable: this.deps.sampler.available
    }
  }

  dispose(): void {
    for (const serverId of [...this.live.keys()]) this.end(serverId)
    this.deps.sampler.dispose()
  }

  private begin(serverId: string): void {
    if (this.live.has(serverId)) return
    const rec = this.deps.store.get(serverId)
    const pid = this.deps.processes.pid(serverId)
    const live: Live = {
      pid,
      cpu: null,
      memBytes: null,
      sampledAt: Number.NEGATIVE_INFINITY,
      prev: null,
      tps: null,
      pointTimer: setInterval(() => this.pushPoint(serverId), this.pointMs)
    }
    this.live.set(serverId, live)
    if (pid !== undefined) this.deps.sampler.track(pid)

    const command = tpsCommandFor(rec.type, rec.mcVersion)
    if (!command) return
    const send = (): void => {
      try {
        this.deps.processes.sendQuietCommand(serverId, command, isTpsReply)
      } catch {
        // The server stopped between ticks; the status event will clean up.
      }
    }
    send()
    live.tpsTimer = setInterval(send, this.deps.tpsIntervalMs ?? TPS_INTERVAL_MS)
  }

  private pushPoint(serverId: string): void {
    const live = this.live.get(serverId)
    if (!live) return
    const at = (this.deps.now ?? Date.now)()
    const fresh = at - live.sampledAt <= 2 * this.pointMs
    const point: StatsPoint = {
      at,
      cpu: fresh ? live.cpu : null,
      memBytes: fresh ? live.memBytes : null,
      tps: live.tps
    }
    this.history.push(serverId, point)
    this.deps.emit({ serverId, point, samplerAvailable: this.deps.sampler.available })
  }

  private stopTps(serverId: string): void {
    const live = this.live.get(serverId)
    if (!live) return
    clearInterval(live.tpsTimer)
    live.tpsTimer = undefined
  }

  private end(serverId: string): void {
    const live = this.live.get(serverId)
    if (live) {
      clearInterval(live.pointTimer)
      clearInterval(live.tpsTimer)
      if (live.pid !== undefined) this.deps.sampler.untrack(live.pid)
      this.live.delete(serverId)
    }
    this.history.clear(serverId)
  }
}

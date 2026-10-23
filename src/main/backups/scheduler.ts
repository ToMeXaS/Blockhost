import type { ServerRecord, ServerStatus } from '../../shared/types'

const HOUR_MS = 3_600_000
const TICK_MS = 60_000
const FIRST_TICK_MS = 30_000

/** Whether a server needs an automatic backup now. `lastMs` is the latest backup or attempt. */
export function isDue(
  rec: ServerRecord,
  status: ServerStatus,
  busy: boolean,
  lastMs: number | null,
  nowMs: number
): boolean {
  const hours = rec.backup?.intervalHours
  if (!hours || status !== 'running' || busy) return false
  return lastMs === null || nowMs - lastMs >= hours * HOUR_MS
}

export interface BackupSchedulerDeps {
  servers: () => ServerRecord[]
  status: (id: string) => ServerStatus
  isBusy: (id: string) => boolean
  latestAutoAt: (id: string) => Promise<number | null>
  /** Makes an automatic backup; failures are recorded by the backup service. */
  backup: (id: string) => Promise<unknown>
  now?: () => number
}

/** Checks every minute for running servers whose automatic backup is due. */
export class BackupScheduler {
  private readonly deps: BackupSchedulerDeps
  private readonly attempts = new Map<string, number>()
  private interval: ReturnType<typeof setInterval> | undefined
  private firstTick: ReturnType<typeof setTimeout> | undefined
  private ticking = false

  constructor(deps: BackupSchedulerDeps) {
    this.deps = deps
  }

  start(): void {
    this.firstTick = setTimeout(() => void this.tick(), FIRST_TICK_MS)
    this.interval = setInterval(() => void this.tick(), TICK_MS)
  }

  dispose(): void {
    clearTimeout(this.firstTick)
    clearInterval(this.interval)
  }

  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      let servers: ServerRecord[]
      try {
        servers = this.deps.servers()
      } catch (err) {
        console.warn('[backups] scheduler skipped', 'servers', err)
        return
      }
      for (const rec of servers) {
        const now = (this.deps.now ?? Date.now)()
        try {
          // Wait a full interval after the last attempt before looking anything up again.
          const attempt = this.attempts.get(rec.id) ?? null
          if (attempt !== null && !isDue(rec, 'running', false, attempt, now)) continue
          const latest = await this.deps.latestAutoAt(rec.id)
          const last = latest === null ? attempt : Math.max(latest, attempt ?? latest)
          if (!isDue(rec, this.deps.status(rec.id), this.deps.isBusy(rec.id), last, now)) continue
          this.attempts.set(rec.id, now)
          try {
            await this.deps.backup(rec.id)
          } catch {
            // Backup failures are recorded by BackupService and shown in the Backups section.
          }
        } catch (err) {
          // Lookup or status errors: skip this server and wait a full interval before retrying.
          this.attempts.set(rec.id, now)
          console.warn('[backups] scheduler skipped', rec.id, err)
        }
      }
    } finally {
      this.ticking = false
    }
  }
}

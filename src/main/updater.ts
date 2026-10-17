import type { UpdateStatus } from '../shared/types'
import { AppError } from './errors'

export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/** The subset of electron-updater's autoUpdater we use (injectable for tests). */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdateServiceDeps {
  updater: UpdaterLike
  enabled: boolean
  currentVersion: string
  emit: (status: UpdateStatus) => void
  intervalMs?: number
}

export class UpdateService {
  private readonly deps: UpdateServiceDeps
  private current: UpdateStatus
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(deps: UpdateServiceDeps) {
    this.deps = deps
    this.current = { state: 'idle', currentVersion: deps.currentVersion }
  }

  status(): UpdateStatus {
    return { ...this.current }
  }

  start(): void {
    if (!this.deps.enabled) return
    const { updater } = this.deps
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.on('checking-for-update', () => this.set({ state: 'checking' }))
    updater.on('update-not-available', () => this.set({ state: 'idle' }))
    updater.on('update-available', (info: { version: string }) =>
      this.set({ state: 'available', version: info.version })
    )
    updater.on('download-progress', (progress: { percent: number }) =>
      this.set({
        state: 'downloading',
        version: this.current.version,
        percent: Math.round(progress.percent)
      })
    )
    updater.on('update-downloaded', (info: { version: string }) =>
      this.set({ state: 'ready', version: info.version })
    )
    updater.on('error', (err: Error) => this.set({ state: 'error', message: err.message }))
    this.check()
    this.timer = setInterval(() => this.check(), this.deps.intervalMs ?? UPDATE_CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Quits and installs the downloaded update; callers stop servers first. */
  install(): void {
    if (this.current.state !== 'ready')
      throw new AppError('NO_UPDATE', 'No update is ready to install')
    this.deps.updater.quitAndInstall(false, true)
  }

  private check(): void {
    // Don't interrupt a download or a ready update with a new check.
    if (this.current.state === 'downloading' || this.current.state === 'ready') return
    this.deps.updater
      .checkForUpdates()
      .catch((err: unknown) =>
        this.set({ state: 'error', message: err instanceof Error ? err.message : String(err) })
      )
  }

  private set(next: Omit<UpdateStatus, 'currentVersion'>): void {
    this.current = { ...next, currentVersion: this.deps.currentVersion }
    this.deps.emit(this.status())
  }
}

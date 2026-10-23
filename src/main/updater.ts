import type { UpdateStatus } from '../shared/types'
import { AppError } from './errors'

export const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000

type StateFields = Omit<UpdateStatus, 'currentVersion' | 'enabled' | 'auto'>

/** The subset of electron-updater's autoUpdater we use (injectable for tests). */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdateServiceDeps {
  updater: UpdaterLike
  enabled: boolean
  /** Check, download and install in the background (the user's setting). */
  auto: boolean
  currentVersion: string
  emit: (status: UpdateStatus) => void
  intervalMs?: number
}

export class UpdateService {
  private readonly deps: UpdateServiceDeps
  private current: StateFields = { state: 'idle' }
  private auto: boolean
  private started = false
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(deps: UpdateServiceDeps) {
    this.deps = deps
    this.auto = deps.auto
  }

  status(): UpdateStatus {
    return {
      ...this.current,
      currentVersion: this.deps.currentVersion,
      enabled: this.deps.enabled,
      auto: this.auto
    }
  }

  start(): void {
    if (!this.deps.enabled || this.started) return
    this.started = true
    const { updater } = this.deps
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
    this.applyAuto()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Turns background checks, downloads and install-on-quit on or off. */
  setAuto(on: boolean): void {
    this.auto = on
    if (this.started) this.applyAuto()
    this.deps.emit(this.status())
  }

  /** Quits and installs the downloaded update; callers stop servers first. */
  install(): void {
    if (this.current.state !== 'ready')
      throw new AppError('NO_UPDATE', 'No update is ready to install')
    // Not silent, so the wizard shows its progress; on an update it skips straight to
    // installing, and its finish page relaunches the app.
    this.deps.updater.quitAndInstall(false, true)
  }

  /** Downloads a found update; only needed when automatic updates are off. */
  download(): void {
    if (this.current.state !== 'available')
      throw new AppError('NO_UPDATE', 'No update is available to download')
    this.set({ state: 'downloading', version: this.current.version, percent: 0 })
    this.deps.updater
      .downloadUpdate()
      .catch((err: unknown) =>
        this.set({ state: 'error', message: err instanceof Error ? err.message : String(err) })
      )
  }

  /**
   * Checks for an update now and resolves with the status afterwards. Background checks
   * (timer, wake-up) are skipped while automatic updates are off; `manual` ones aren't.
   */
  async check(opts: { manual?: boolean } = {}): Promise<UpdateStatus> {
    if (!this.started || (!opts.manual && !this.auto)) return this.status()
    // Don't overlap a check, or interrupt a download or a ready update.
    const { state } = this.current
    if (state === 'checking' || state === 'downloading' || state === 'ready') return this.status()
    try {
      await this.deps.updater.checkForUpdates()
    } catch (err) {
      this.set({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return this.status()
  }

  private applyAuto(): void {
    const { updater } = this.deps
    updater.autoDownload = this.auto
    updater.autoInstallOnAppQuit = this.auto
    if (!this.auto) {
      this.stop()
      return
    }
    if (!this.timer) {
      this.timer = setInterval(
        () => void this.check(),
        this.deps.intervalMs ?? UPDATE_CHECK_INTERVAL_MS
      )
    }
    void this.check()
  }

  private set(next: StateFields): void {
    this.current = next
    this.deps.emit(this.status())
  }
}

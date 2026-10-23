import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_BACKUP_SETTINGS,
  type BackupFailure,
  type BackupInfo,
  type BackupKind,
  type BackupList,
  type BackupLocation,
  type BackupMeta,
  type BackupProgress,
  type BackupsChangedEvent,
  type RestoreAsNewInput,
  type ServerLogEvent,
  type ServerRecord
} from '../../shared/types'
import { AppError } from '../errors'
import type { ProcessManager } from '../servers/process'
import type { ServerStore } from '../servers/store'
import type { SettingsStore } from '../settings'
import { updateProperties } from '../servers/properties'
import { isEmptyOrMissingDir, pathExists } from '../util/fs'
import { readMeta, unzipTo, zipFolder } from './archive'
import {
  backupFileName,
  isBackupFileName,
  listBackups,
  parseBackupFileName,
  pickPruned
} from './store'

export const SAVE_TIMEOUT_MS = 60_000
const SAVED_PATTERN = /Saved the (game|world)/i
const STAGING_SUFFIX = '.blockhost-restoring'
const OLD_SUFFIX = '.blockhost-old'
const RM_OPTS = { recursive: true, force: true, maxRetries: 3, retryDelay: 200 } as const

export interface BackupServiceDeps {
  store: Pick<ServerStore, 'get' | 'list' | 'add' | 'update'>
  processes: Pick<ProcessManager, 'isActive' | 'status' | 'sendCommand'>
  settings: Pick<SettingsStore, 'get' | 'setBackupsDir'>
  defaultRoot: string
  isPortFree: (port: number) => Promise<boolean>
  emitProgress: (event: BackupProgress) => void
  emitChanged: (event: BackupsChangedEvent) => void
  now?: () => Date
  newId?: () => string
  saveTimeoutMs?: number
}

interface SaveWaiter {
  serverId: string
  resolve: () => void
}

export class BackupService {
  private readonly deps: BackupServiceDeps
  private readonly busy = new Set<string>()
  private readonly waiters = new Set<SaveWaiter>()
  private readonly failures = new Map<string, BackupFailure>()

  constructor(deps: BackupServiceDeps) {
    this.deps = deps
  }

  isBusy(id: string): boolean {
    return this.busy.has(id)
  }

  location(): BackupLocation {
    const custom = this.deps.settings.get().backupsDir
    return custom
      ? { dir: custom, isDefault: false }
      : { dir: this.deps.defaultRoot, isDefault: true }
  }

  /** Checks the folder is writable before saving it. `null` resets to the default. */
  async setLocation(dir: string | null): Promise<BackupLocation> {
    if (dir !== null) {
      const probe = join(dir, `.blockhost-write-test-${Date.now()}`)
      try {
        await mkdir(dir, { recursive: true })
        await writeFile(probe, '')
        await rm(probe, { force: true })
      } catch (err) {
        throw new AppError(
          'BACKUP_DIR_UNWRITABLE',
          `Blockhost can't write to ${dir}: ${(err as Error).message}`
        )
      }
    }
    await this.deps.settings.setBackupsDir(dir)
    return this.location()
  }

  dirFor(id: string): string {
    return join(this.location().dir, id)
  }

  async list(id: string): Promise<BackupList> {
    this.deps.store.get(id)
    return {
      items: await listBackups(this.dirFor(id)),
      lastAutoFailure: this.failures.get(id) ?? null
    }
  }

  async latestAutoAt(id: string): Promise<number | null> {
    const latest = (await listBackups(this.dirFor(id))).find((b) => b.kind === 'auto')
    return latest ? Date.parse(latest.createdAt) : null
  }

  async bytes(id: string): Promise<number> {
    return (await listBackups(this.dirFor(id))).reduce((sum, b) => sum + b.bytes, 0)
  }

  /** Absolute path of one of this server's backups; validates the name. */
  async filePath(id: string, file: string): Promise<string> {
    if (!isBackupFileName(file)) throw new AppError('INVALID_INPUT', 'Not a backup file name')
    const path = join(this.dirFor(id), file)
    if (!(await pathExists(path))) throw new AppError('NOT_FOUND', 'That backup no longer exists')
    return path
  }

  async create(id: string, kind: 'manual' | 'auto'): Promise<BackupInfo> {
    try {
      const info = await this.withLock(id, async () => {
        const created = await this.backup(id, kind)
        if (kind === 'auto') {
          try {
            await this.prune(id)
          } catch {
            // A locked old zip is retried at the next automatic backup.
          }
        }
        return created
      })
      if (kind === 'auto' && this.failures.delete(id)) this.deps.emitChanged({ serverId: id })
      return info
    } catch (err) {
      if (kind === 'auto' && !(err instanceof AppError && err.code === 'BUSY')) {
        this.failures.set(id, { at: this.now().toISOString(), message: (err as Error).message })
        this.deps.emitChanged({ serverId: id })
      }
      throw err
    }
  }

  meta(id: string, file: string): Promise<BackupMeta | null> {
    return this.filePath(id, file).then(readMeta)
  }

  /** Replaces the server folder with the backup. The server must be stopped. */
  restore(id: string, file: string): Promise<void> {
    return this.withLock(id, async () => {
      const rec = this.deps.store.get(id)
      if (this.deps.processes.isActive(id)) {
        throw new AppError('SERVER_RUNNING', 'Stop the server before restoring a backup')
      }
      const zip = await this.filePath(id, file)
      const meta = await readMeta(zip)
      const staging = `${rec.dir}${STAGING_SUFFIX}`
      const old = `${rec.dir}${OLD_SUFFIX}`
      if (!(await pathExists(rec.dir)) && (await pathExists(old))) await rename(old, rec.dir)
      if (await pathExists(rec.dir)) await this.backup(id, 'pre-restore')

      await rm(staging, RM_OPTS)
      try {
        await unzipTo(zip, staging, (percent) =>
          this.deps.emitProgress({ serverId: id, op: 'restore', percent })
        )
      } catch (err) {
        await rm(staging, RM_OPTS)
        throw err
      }

      await rm(old, RM_OPTS)
      const hadDir = await pathExists(rec.dir)
      try {
        if (hadDir) await rename(rec.dir, old)
      } catch (err) {
        await rm(staging, RM_OPTS)
        throw new AppError(
          'RESTORE_LOCKED',
          `Could not replace the server folder. Close any program using it and try again. (${(err as Error).message})`
        )
      }
      try {
        await rename(staging, rec.dir)
      } catch (err) {
        if (hadDir) await rename(old, rec.dir)
        await rm(staging, RM_OPTS)
        throw err
      }
      await rm(old, RM_OPTS).catch(() => {})

      if (meta) {
        const s = meta.server
        const differs =
          s.type !== rec.type ||
          s.mcVersion !== rec.mcVersion ||
          s.build !== rec.build ||
          JSON.stringify(s.launch) !== JSON.stringify(rec.launch)
        if (differs) {
          await this.deps.store.update(id, {
            type: s.type,
            mcVersion: s.mcVersion,
            build: s.build,
            launch: s.launch
          })
        }
      }
      this.deps.emitChanged({ serverId: id })
    })
  }

  /** Unpacks a Blockhost-made backup into a new folder and registers it as a new server. */
  restoreAsNew(id: string, file: string, input: RestoreAsNewInput): Promise<ServerRecord> {
    return this.withLock(id, async () => {
      const zip = await this.filePath(id, file)
      const meta = await readMeta(zip)
      if (!meta) {
        throw new AppError(
          'NO_METADATA',
          'This backup was not made by Blockhost, so it can only be restored over an existing server'
        )
      }
      const name = input.name.trim()
      const taken = this.deps.store.list().some((s) => s.name.toLowerCase() === name.toLowerCase())
      if (taken) throw new AppError('NAME_TAKEN', `A server named "${name}" already exists`)
      if (!(await isEmptyOrMissingDir(input.dir))) {
        throw new AppError('DIR_NOT_EMPTY', 'Choose an empty folder for the restored server')
      }
      if (!(await this.deps.isPortFree(input.port))) {
        throw new AppError('PORT_IN_USE', `Port ${input.port} is already in use`, {
          port: input.port
        })
      }

      const existed = await pathExists(input.dir)
      const s = meta.server
      const rec: ServerRecord = {
        id: (this.deps.newId ?? randomUUID)(),
        name,
        type: s.type,
        mcVersion: s.mcVersion,
        ...(s.build ? { build: s.build } : {}),
        dir: input.dir,
        ramMb: s.ramMb,
        port: input.port,
        jvmArgs: s.jvmArgs,
        ...(s.launch ? { launch: s.launch } : {}),
        installState: 'ready',
        createdAt: this.now().toISOString()
      }
      try {
        await unzipTo(zip, input.dir, (percent) =>
          this.deps.emitProgress({ serverId: id, op: 'restore', percent })
        )
        if (s.port !== input.port) {
          await updateProperties(input.dir, { 'server-port': String(input.port) })
        }
        await this.deps.store.add(rec)
      } catch (err) {
        await this.cleanupRestored(input.dir, existed)
        throw err
      }
      return rec
    })
  }

  /** Best-effort: removes what we extracted, but never a folder the user already had. */
  private async cleanupRestored(dir: string, existed: boolean): Promise<void> {
    try {
      if (!existed) {
        await rm(dir, RM_OPTS)
        return
      }
      for (const name of await readdir(dir)) await rm(join(dir, name), RM_OPTS)
    } catch {
      // Keep the original error.
    }
  }

  async delete(id: string, file: string): Promise<void> {
    if (this.busy.has(id)) {
      throw new AppError('BUSY', 'Wait for the current backup or restore to finish')
    }
    await rm(await this.filePath(id, file), { force: true })
    this.deps.emitChanged({ serverId: id })
  }

  /** Removes the server's whole backup folder (used when the server is deleted). */
  async deleteAll(id: string): Promise<void> {
    await rm(this.dirFor(id), RM_OPTS)
    this.failures.delete(id)
  }

  /** Startup cleanup after a crash: finish or undo half-done restores, drop partial zips. */
  async recover(): Promise<void> {
    for (const rec of this.deps.store.list()) {
      const old = `${rec.dir}${OLD_SUFFIX}`
      try {
        if (!(await pathExists(rec.dir)) && (await pathExists(old))) await rename(old, rec.dir)
        await rm(`${rec.dir}${STAGING_SUFFIX}`, RM_OPTS)
        await rm(old, RM_OPTS)
      } catch {
        // Locked; try again next start.
      }
    }
    const root = this.location().dir
    let ids: string[]
    try {
      ids = await readdir(root)
    } catch {
      return
    }
    for (const id of ids) {
      let names: string[]
      try {
        names = await readdir(join(root, id))
      } catch {
        continue
      }
      for (const name of names) {
        if (name.endsWith('.zip.partial'))
          await rm(join(root, id, name), { force: true }).catch(() => {})
      }
    }
  }

  /** Fed every console batch; resolves pending save handshakes. */
  onLog(event: ServerLogEvent): void {
    if (!event.lines.some((line) => SAVED_PATTERN.test(line))) return
    for (const waiter of [...this.waiters]) {
      if (waiter.serverId === event.serverId) waiter.resolve()
    }
  }

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(id)) {
      throw new AppError('BUSY', 'A backup or restore is already running for this server')
    }
    this.busy.add(id)
    try {
      return await fn()
    } finally {
      this.busy.delete(id)
    }
  }

  /** Makes one backup; the caller holds the lock. */
  private async backup(id: string, kind: BackupKind): Promise<BackupInfo> {
    const rec = this.deps.store.get(id)
    const { processes } = this.deps
    const live = processes.isActive(id)
    if (live && processes.status(id) !== 'running') {
      throw new AppError(
        'SERVER_BUSY',
        'Wait for the server to finish starting or stopping before backing up'
      )
    }
    let savingOff = false
    const save = live ? this.waitForSave(id) : null
    try {
      if (save) {
        processes.sendCommand(id, 'save-off')
        savingOff = true
        processes.sendCommand(id, 'save-all flush')
        await save.done
      }
      return await this.writeZip(rec, kind)
    } finally {
      save?.cancel()
      if (savingOff && processes.isActive(id)) {
        try {
          processes.sendCommand(id, 'save-on')
        } catch {
          // The server stopped in the meantime; nothing to turn back on.
        }
      }
    }
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))()
  }

  private async writeZip(rec: ServerRecord, kind: BackupKind): Promise<BackupInfo> {
    const dir = this.dirFor(rec.id)
    let date = this.now()
    let file = backupFileName(date, kind)
    while (await pathExists(join(dir, file))) {
      date = new Date(date.getTime() + 1000)
      file = backupFileName(date, kind)
    }
    const createdAt = parseBackupFileName(file)!.createdAt
    const meta: BackupMeta = {
      version: 1,
      createdAt,
      kind,
      server: {
        name: rec.name,
        type: rec.type,
        mcVersion: rec.mcVersion,
        ...(rec.build ? { build: rec.build } : {}),
        ramMb: rec.ramMb,
        jvmArgs: rec.jvmArgs,
        ...(rec.launch ? { launch: rec.launch } : {}),
        port: rec.port
      }
    }
    const path = join(dir, file)
    await zipFolder(rec.dir, path, {
      meta,
      onProgress: (percent) => this.deps.emitProgress({ serverId: rec.id, op: 'backup', percent })
    })
    this.deps.emitChanged({ serverId: rec.id })
    return { file, kind, createdAt, bytes: (await stat(path)).size }
  }

  private async prune(id: string): Promise<void> {
    const { keep } = this.deps.store.get(id).backup ?? DEFAULT_BACKUP_SETTINGS
    const dir = this.dirFor(id)
    const old = pickPruned(await listBackups(dir), keep)
    for (const backup of old) await rm(join(dir, backup.file), { force: true })
    if (old.length > 0) this.deps.emitChanged({ serverId: id })
  }

  private waitForSave(id: string): { done: Promise<void>; cancel: () => void } {
    let cancel = (): void => {}
    const done = new Promise<void>((resolve, reject) => {
      const waiter: SaveWaiter = {
        serverId: id,
        resolve: () => {
          cancel()
          resolve()
        }
      }
      const timer = setTimeout(() => {
        cancel()
        reject(
          new AppError(
            'SAVE_TIMEOUT',
            'The server did not confirm saving the world within 60 seconds. Try again, or stop the server and back up.'
          )
        )
      }, this.deps.saveTimeoutMs ?? SAVE_TIMEOUT_MS)
      cancel = () => {
        clearTimeout(timer)
        this.waiters.delete(waiter)
      }
      this.waiters.add(waiter)
    })
    done.catch(() => {}) // awaited by the caller; avoid unhandled rejections if it bails early
    return { done, cancel: () => cancel() }
  }
}

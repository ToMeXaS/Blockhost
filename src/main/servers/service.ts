import type {
  CreateServerInput,
  PropertyEntry,
  ServerPatch,
  ServerRecord,
  ServerView,
  UpdateResult
} from '../../shared/types'
import { AppError } from '../errors'
import type { JavaResolver } from '../java/resolver'
import type { ServerInstaller } from './installer'
import type { ProcessManager } from './process'
import { readPropertiesFile, updateProperties, writePropertiesFile } from './properties'
import type { ServerStore } from './store'

export const RESTART_STOP_TIMEOUT_MS = 30_000

export interface ServerServiceDeps {
  store: ServerStore
  installer: Pick<ServerInstaller, 'create' | 'retry' | 'isInstalling'>
  processes: Pick<
    ProcessManager,
    'status' | 'isActive' | 'start' | 'stop' | 'kill' | 'waitForExit' | 'sendCommand' | 'getLog'
  >
  java: Pick<JavaResolver, 'forStart' | 'requiredMajor'>
  probeJava: (javaPath: string) => Promise<number | null>
  isPortFree: (port: number) => Promise<boolean>
  removeDir: (dir: string) => Promise<void>
}

export class ServerService {
  private readonly deps: ServerServiceDeps
  private readonly approvedJavaPaths = new Set<string>()

  constructor(deps: ServerServiceDeps) {
    this.deps = deps
  }

  /** Called by the main-process file picker; only these paths may become a custom Java. */
  approveJavaPath(path: string): void {
    this.approvedJavaPaths.add(path)
  }

  list(): ServerView[] {
    return this.deps.store.list().map((rec) => this.view(rec))
  }

  dir(id: string): string {
    return this.deps.store.get(id).dir
  }

  getLog(id: string): string[] {
    this.deps.store.get(id)
    return this.deps.processes.getLog(id)
  }

  async create(input: CreateServerInput): Promise<ServerView> {
    return this.view(await this.deps.installer.create(input))
  }

  async retryInstall(id: string): Promise<ServerView> {
    return this.view(await this.deps.installer.retry(id))
  }

  async update(id: string, patch: ServerPatch): Promise<UpdateResult> {
    const rec = this.deps.store.get(id)
    let warning: string | undefined

    if (patch.name !== undefined) {
      const name = patch.name.trim()
      const taken = this.deps.store
        .list()
        .some((s) => s.id !== id && s.name.toLowerCase() === name.toLowerCase())
      if (taken) throw new AppError('NAME_TAKEN', `A server named "${name}" already exists`)
    }

    let javaPath = rec.javaPath
    if (patch.javaPath === null) {
      javaPath = undefined
    } else if (patch.javaPath !== undefined && patch.javaPath !== rec.javaPath) {
      if (!this.approvedJavaPaths.has(patch.javaPath)) {
        throw new AppError('JAVA_NOT_APPROVED', 'Choose the Java executable with the Browse button')
      }
      const major = await this.deps.probeJava(patch.javaPath)
      if (major === null)
        throw new AppError('JAVA_INVALID', `${patch.javaPath} is not a working Java`)
      const required = await this.deps.java.requiredMajor(rec.mcVersion)
      if (major < required) {
        warning = `This Java is version ${major}, but Minecraft ${rec.mcVersion} needs Java ${required}. The server may not start.`
      }
      javaPath = patch.javaPath
    }

    if (patch.port !== undefined && patch.port !== rec.port && rec.installState === 'ready') {
      await updateProperties(rec.dir, { 'server-port': String(patch.port) })
    }

    const updated = await this.deps.store.update(id, {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.ramMb !== undefined ? { ramMb: patch.ramMb } : {}),
      ...(patch.port !== undefined ? { port: patch.port } : {}),
      ...(patch.jvmArgs !== undefined ? { jvmArgs: patch.jvmArgs } : {}),
      javaPath
    })
    return { server: this.view(updated), ...(warning ? { warning } : {}) }
  }

  async remove(id: string, keepFiles: boolean): Promise<void> {
    if (this.deps.processes.isActive(id)) {
      throw new AppError('SERVER_RUNNING', 'Stop the server before deleting it')
    }
    if (this.deps.installer.isInstalling(id)) {
      throw new AppError('INSTALLING', 'Wait for the installation to finish before deleting')
    }
    const rec = this.deps.store.get(id)
    await this.deps.store.remove(id)
    if (!keepFiles) await this.deps.removeDir(rec.dir)
  }

  async start(id: string): Promise<void> {
    const rec = this.deps.store.get(id)
    if (rec.installState !== 'ready' || !rec.launch) {
      throw new AppError('NOT_INSTALLED', 'This server has not finished installing')
    }
    if (this.deps.processes.isActive(id)) {
      throw new AppError('ALREADY_RUNNING', 'The server is already running')
    }
    if (!(await this.deps.isPortFree(rec.port))) {
      throw new AppError('PORT_IN_USE', `Port ${rec.port} is already in use by another program`, {
        port: rec.port
      })
    }
    const javaPath = await this.deps.java.forStart(rec)
    this.deps.processes.start(rec, javaPath)
  }

  stop(id: string): void {
    this.deps.processes.stop(id)
  }

  async restart(id: string): Promise<void> {
    if (this.deps.processes.isActive(id)) {
      this.deps.processes.stop(id)
      const stopped = await this.deps.processes.waitForExit(id, RESTART_STOP_TIMEOUT_MS)
      if (!stopped) throw new AppError('STOP_TIMEOUT', 'The server did not stop within 30 seconds')
    }
    await this.start(id)
  }

  kill(id: string): Promise<void> {
    return this.deps.processes.kill(id)
  }

  sendCommand(id: string, command: string): void {
    this.deps.processes.sendCommand(id, command)
  }

  readProperties(id: string): Promise<PropertyEntry[]> {
    return readPropertiesFile(this.deps.store.get(id).dir)
  }

  async writeProperties(id: string, entries: PropertyEntry[]): Promise<void> {
    const rec = this.deps.store.get(id)
    await writePropertiesFile(rec.dir, entries)
    const portValue = entries.find((e) => e.key === 'server-port')?.value
    const port = portValue && /^\d+$/.test(portValue) ? Number(portValue) : NaN
    if (port >= 1 && port <= 65535 && port !== rec.port) await this.deps.store.update(id, { port })
  }

  private view(rec: ServerRecord): ServerView {
    return { ...rec, status: this.deps.processes.status(rec.id) }
  }
}

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  CreateServerInput,
  InstallProgress,
  InstallStep,
  ServerRecord,
  ServerType
} from '../../shared/types'
import { AppError } from '../errors'
import type { JavaResolver } from '../java/resolver'
import type { ServerProvider } from '../providers/types'
import { isEmptyOrMissingDir } from '../util/fs'
import { readPropertiesFile, updateProperties } from './properties'
import type { ServerStore } from './store'

export interface InstallerDeps {
  store: ServerStore
  providers: Record<ServerType, ServerProvider>
  java: Pick<JavaResolver, 'forInstall'>
  emit: (progress: InstallProgress) => void
  newId?: () => string
  now?: () => Date
}

const MAX_LOG_LINES = 2000

function withSep(path: string): string {
  const resolved = resolve(path)
  return resolved.endsWith('\\') ? resolved : `${resolved}\\`
}

/** True if `a` and `b` are the same folder, or one is nested inside the other. */
const overlapsPath = (a: string, b: string): boolean => {
  const normA = withSep(a).toLowerCase()
  const normB = withSep(b).toLowerCase()
  return normA === normB || normA.startsWith(normB) || normB.startsWith(normA)
}

export class ServerInstaller {
  private readonly deps: InstallerDeps
  private readonly logs = new Map<string, string[]>()
  private readonly jobs = new Map<string, Promise<void>>()

  constructor(deps: InstallerDeps) {
    this.deps = deps
  }

  async create(input: CreateServerInput): Promise<ServerRecord> {
    if (!input.eulaAccepted)
      throw new AppError('EULA_REQUIRED', 'You must accept the Minecraft EULA')
    const name = input.name.trim()
    const existing = this.deps.store.list()
    if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      throw new AppError('NAME_TAKEN', `A server named "${name}" already exists`)
    }
    if (existing.some((s) => overlapsPath(s.dir, input.dir))) {
      throw new AppError('DIR_IN_USE', 'Another server already uses this folder')
    }
    if (!(await isEmptyOrMissingDir(input.dir))) {
      throw new AppError('DIR_NOT_EMPTY', `The folder ${input.dir} is not empty`)
    }

    const rec: ServerRecord = {
      id: (this.deps.newId ?? randomUUID)(),
      name,
      type: input.type,
      mcVersion: input.mcVersion,
      build: input.build,
      dir: input.dir,
      ramMb: input.ramMb,
      port: input.port,
      jvmArgs: [],
      installState: 'installing',
      createdAt: (this.deps.now ?? (() => new Date()))().toISOString()
    }
    await this.deps.store.add(rec)
    this.startJob(rec.id)
    return rec
  }

  async retry(id: string): Promise<ServerRecord> {
    if (this.jobs.has(id)) throw new AppError('INSTALLING', 'This server is already installing')
    if (this.deps.store.get(id).installState !== 'failed') {
      throw new AppError('NOT_FAILED', 'Only a failed installation can be retried')
    }
    const rec = await this.deps.store.update(id, { installState: 'installing' })
    this.startJob(id)
    return rec
  }

  isInstalling(id: string): boolean {
    return this.jobs.has(id)
  }

  waitFor(id: string): Promise<void> {
    return this.jobs.get(id) ?? Promise.resolve()
  }

  getLog(id: string): string[] {
    return [...(this.logs.get(id) ?? [])]
  }

  private startJob(id: string): void {
    const job = this.run(id).finally(() => this.jobs.delete(id))
    this.jobs.set(id, job)
  }

  private async run(id: string): Promise<void> {
    const log: string[] = []
    this.logs.set(id, log)
    const report = (step: InstallStep, message: string, percent?: number): void => {
      if (message) {
        log.push(message)
        if (log.length > MAX_LOG_LINES) log.splice(0, log.length - MAX_LOG_LINES)
      }
      this.deps.emit({ serverId: id, step, message, ...(percent === undefined ? {} : { percent }) })
    }

    try {
      const rec = this.deps.store.get(id)
      const provider = this.deps.providers[rec.type]
      await mkdir(rec.dir, { recursive: true })

      report('java', 'Preparing Java…')
      const javaPath = await this.deps.java.forInstall(rec, (pct) => report('java', '', pct))

      report('server', `Installing ${provider.label} ${rec.mcVersion}…`)
      const launch = await provider.install({
        dir: rec.dir,
        version: rec.mcVersion,
        build: rec.build,
        javaPath,
        onLog: (line) => report('installer', line),
        onProgress: (pct) => report('server', '', pct)
      })

      report('config', 'Writing eula.txt and server.properties…')
      await writeFile(
        join(rec.dir, 'eula.txt'),
        `# Accepted in Blockhost on ${new Date().toISOString()} (https://aka.ms/MinecraftEULA)\neula=true\n`
      )
      const hasMotd = (await readPropertiesFile(rec.dir)).some((e) => e.key === 'motd')
      await updateProperties(rec.dir, {
        'server-port': String(rec.port),
        ...(hasMotd ? {} : { motd: `${rec.name} - a Blockhost server` })
      })

      await this.deps.store.update(id, { launch, installState: 'ready' })
      report('done', 'Server installed')
    } catch (err) {
      await this.deps.store.update(id, { installState: 'failed' }).catch(() => {})
      report('error', err instanceof Error ? err.message : String(err))
    }
  }
}

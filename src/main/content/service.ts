import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  SERVER_TYPE_LABELS,
  type ContentInstallResult,
  type ContentSearchResult,
  type InstalledContent,
  type InstalledContentList,
  type ServerRecord
} from '../../shared/types'
import { AppError } from '../errors'
import type { DownloadFn } from '../net/download'
import type { ProcessManager } from '../servers/process'
import type { ServerStore } from '../servers/store'
import { pathExists } from '../util/fs'
import { contentTarget, type ContentTarget } from './loaders'
import { readManifest, writeManifest, type Manifest, type ManifestEntry } from './manifest'
import type { ModrinthClient } from './modrinth'
import { planInstall, type PlanItem } from './resolver'

const RESERVED_DEVICE_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i
const FORBIDDEN_CHARS = /[<>:"/\\|?*\u0000-\u001f]/

export function safeFileName(name: string): string {
  const ok =
    name.length > 0 &&
    name.length <= 200 &&
    !FORBIDDEN_CHARS.test(name) &&
    !name.includes('..') &&
    name.toLowerCase().endsWith('.jar') &&
    !/[. ]$/.test(name) &&
    !RESERVED_DEVICE_NAMES.test(name)
  if (!ok) throw new AppError('CONTENT_BAD_FILENAME', `Refusing to use the file name "${name}".`)
  return name
}

export async function sha1File(path: string): Promise<string> {
  const hash = createHash('sha1')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

const isOfflineError = (err: unknown): boolean =>
  err instanceof AppError && (err.code === 'NETWORK' || err.code === 'MODRINTH_API')

export interface ContentServiceDeps {
  store: Pick<ServerStore, 'get'>
  processes: Pick<ProcessManager, 'status'>
  client: ModrinthClient
  download: DownloadFn
  hashFile?: (path: string) => Promise<string>
}

interface Ctx {
  rec: ServerRecord
  target: ContentTarget
  folder: string
  label: string
}

export class ContentService {
  private readonly deps: ContentServiceDeps
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(deps: ContentServiceDeps) {
    this.deps = deps
  }

  search(serverId: string, query: string, offset: number): Promise<ContentSearchResult> {
    return this.serial(serverId, async () => {
      const { rec, target } = this.ctx(serverId)
      const installed = new Set((await readManifest(rec.dir)).entries.map((e) => e.projectId))
      const r = await this.deps.client.search(target, rec.mcVersion, query, offset)
      return {
        total: r.total,
        hits: r.hits.map((h) => ({
          projectId: h.project_id,
          slug: h.slug,
          title: h.title,
          description: h.description,
          iconUrl: h.icon_url,
          downloads: h.downloads,
          installed: installed.has(h.project_id)
        }))
      }
    })
  }

  listInstalled(serverId: string): Promise<InstalledContentList> {
    return this.serial(serverId, async () => {
      const { rec, target, folder } = this.ctx(serverId)
      const hashFile = this.deps.hashFile ?? sha1File
      const files = await this.jarFiles(folder)
      const manifest = await readManifest(rec.dir)
      const shas = new Map<string, string>()
      for (const f of files) shas.set(f, await hashFile(join(folder, f)))

      const known = manifest.entries.filter((e) => shas.get(e.fileName) === e.sha1)
      const knownNames = new Set(known.map((e) => e.fileName))
      const unknown = files.filter((f) => !knownNames.has(f))
      const entries = [...known]
      let offline = false

      if (unknown.length) {
        try {
          const found = await this.deps.client.identify(unknown.map((f) => shas.get(f)!))
          const hits = unknown.filter((f) => found[shas.get(f)!])
          const projects = await this.deps.client.projects([
            ...new Set(hits.map((f) => found[shas.get(f)!].project_id))
          ])
          const titles = new Map(projects.map((p) => [p.id, p.title]))
          for (const f of hits) {
            const v = found[shas.get(f)!]
            entries.push({
              fileName: f,
              projectId: v.project_id,
              versionId: v.id,
              title: titles.get(v.project_id) ?? f,
              versionNumber: v.version_number,
              sha1: shas.get(f)!,
              dependencyOf: []
            })
          }
        } catch (err) {
          if (!isOfflineError(err)) throw err
          offline = true
        }
      }

      if (!sameEntries(entries, manifest.entries))
        await writeManifest(rec.dir, { version: 1, entries })

      let updates: Record<string, { id: string; version_number: string }> = {}
      if (!offline && entries.length) {
        try {
          updates = await this.deps.client.latest(
            entries.map((e) => e.sha1),
            target.loaders,
            rec.mcVersion
          )
        } catch (err) {
          if (!isOfflineError(err)) throw err
          offline = true
        }
      }

      const byName = new Map(entries.map((e) => [e.fileName, e]))
      const titleOf = new Map(entries.map((e) => [e.projectId, e.title]))
      const items: InstalledContent[] = files.map((f) => {
        const e = byName.get(f)
        if (!e)
          return { fileName: f, title: f, versionNumber: null, source: 'manual', neededBy: [] }
        const u = updates[e.sha1]
        return {
          fileName: f,
          title: e.title,
          versionNumber: e.versionNumber,
          source: 'modrinth',
          projectId: e.projectId,
          ...(u && u.id !== e.versionId
            ? { update: { versionId: u.id, versionNumber: u.version_number } }
            : {}),
          neededBy: e.dependencyOf.filter((p) => titleOf.has(p)).map((p) => titleOf.get(p)!)
        }
      })
      items.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
      return { items, offline }
    })
  }

  install(serverId: string, projectIdOrSlug: string): Promise<ContentInstallResult> {
    return this.serial(serverId, async () => {
      const c = this.ctx(serverId)
      const manifest = await readManifest(c.rec.dir)
      const plan = await this.plan(c, manifest, projectIdOrSlug)
      await this.apply(c, manifest, plan, null)
      return this.result(c, plan)
    })
  }

  update(serverId: string, fileName: string): Promise<ContentInstallResult> {
    return this.serial(serverId, async () => {
      const c = this.ctx(serverId)
      this.requireStopped(c)
      const name = safeFileName(fileName)
      const manifest = await readManifest(c.rec.dir)
      const entry = manifest.entries.find((e) => e.fileName === name)
      if (!entry) {
        throw new AppError(
          'NOT_FOUND',
          `${name} was not installed from Modrinth, so Blockhost cannot update it.`
        )
      }
      const latest = (
        await this.deps.client.latest([entry.sha1], c.target.loaders, c.rec.mcVersion)
      )[entry.sha1]
      if (!latest || latest.id === entry.versionId) return { installed: [], restartNeeded: false }

      const others: Manifest = { version: 1, entries: manifest.entries.filter((e) => e !== entry) }
      const plan = await this.plan(c, others, entry.projectId, latest.id)
      if (plan[0]) plan[0].dependencyOf = entry.dependencyOf
      await this.apply(c, others, plan, entry)
      return this.result(c, plan)
    })
  }

  remove(serverId: string, fileName: string): Promise<void> {
    return this.serial(serverId, async () => {
      const c = this.ctx(serverId)
      this.requireStopped(c)
      const name = safeFileName(fileName)
      await rm(join(c.folder, name), { force: true })
      const manifest = await readManifest(c.rec.dir)
      const entries = manifest.entries.filter((e) => e.fileName !== name)
      if (entries.length !== manifest.entries.length)
        await writeManifest(c.rec.dir, { version: 1, entries })
    })
  }

  private ctx(serverId: string): Ctx {
    const rec = this.deps.store.get(serverId)
    const target = contentTarget(rec.type)
    if (!target)
      throw new AppError('CONTENT_NOT_SUPPORTED', 'Vanilla servers cannot use mods or plugins.')
    return {
      rec,
      target,
      folder: join(rec.dir, target.folder),
      label: `${SERVER_TYPE_LABELS[rec.type]} ${rec.mcVersion}`
    }
  }

  private isUp(serverId: string): boolean {
    const s = this.deps.processes.status(serverId)
    return s === 'starting' || s === 'running' || s === 'stopping'
  }

  private requireStopped(c: Ctx): void {
    if (this.isUp(c.rec.id)) {
      throw new AppError(
        'SERVER_RUNNING',
        `Stop the server before updating or removing ${c.target.label.toLowerCase()}.`
      )
    }
  }

  private plan(
    c: Ctx,
    manifest: Manifest,
    projectIdOrSlug: string,
    versionId?: string
  ): Promise<PlanItem[]> {
    return planInstall(
      projectIdOrSlug,
      {
        client: this.deps.client,
        loaders: c.target.loaders,
        mcVersion: c.rec.mcVersion,
        installedProjectIds: new Set(manifest.entries.map((e) => e.projectId)),
        targetLabel: c.label
      },
      versionId
    )
  }

  /** Downloads the plan; `replacing` is the entry an update supersedes. */
  private async apply(
    c: Ctx,
    manifest: Manifest,
    plan: PlanItem[],
    replacing: ManifestEntry | null
  ): Promise<void> {
    const names = plan.map((item) => safeFileName(item.file.filename))
    const written: string[] = []
    try {
      for (const [i, item] of plan.entries()) {
        const dest = join(c.folder, names[i])
        const isReplacement = i === 0 && replacing !== null && names[i] === replacing.fileName
        if (!isReplacement && (await pathExists(dest))) continue
        await this.deps.download({
          url: item.file.url,
          dest,
          hash: { algo: 'sha512', value: item.file.sha512 }
        })
        written.push(dest)
      }
    } catch (err) {
      for (const file of written) await rm(file, { force: true })
      throw err
    }
    if (replacing && replacing.fileName !== names[0])
      await rm(join(c.folder, replacing.fileName), { force: true })

    const entries = manifest.entries.filter((e) => !names.includes(e.fileName))
    plan.forEach((item, i) =>
      entries.push({
        fileName: names[i],
        projectId: item.projectId,
        versionId: item.versionId,
        title: item.title,
        versionNumber: item.versionNumber,
        sha1: item.file.sha1,
        dependencyOf: item.dependencyOf
      })
    )
    if (plan.length || replacing) await writeManifest(c.rec.dir, { version: 1, entries })
  }

  private result(c: Ctx, plan: PlanItem[]): ContentInstallResult {
    return {
      installed: plan.map((item, i) => ({
        title: item.title,
        versionNumber: item.versionNumber,
        asDependency: i > 0
      })),
      restartNeeded: plan.length > 0 && this.isUp(c.rec.id)
    }
  }

  private async jarFiles(folder: string): Promise<string[]> {
    try {
      return (await readdir(folder)).filter((f) => f.toLowerCase().endsWith('.jar')).sort()
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  private serial<T>(serverId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(serverId) ?? Promise.resolve()
    const run = previous.then(fn, fn)
    this.queues.set(
      serverId,
      run.catch(() => {})
    )
    return run
  }
}

function sameEntries(a: ManifestEntry[], b: ManifestEntry[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

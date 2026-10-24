import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  CONTENT_SOURCE_LABELS,
  SERVER_TYPE_LABELS,
  type ContentInstallResult,
  type ContentSearchResult,
  type InstalledContent,
  type ContentSource,
  type InstalledContentList,
  type ServerRecord
} from '../../shared/types'
import { AppError } from '../errors'
import { isSourceDown } from './http'
import type { DownloadFn } from '../net/download'
import type { ProcessManager } from '../servers/process'
import type { ServerStore } from '../servers/store'
import { pathExists } from '../util/fs'
import { contentTarget, type ContentTarget } from './loaders'
import {
  entryKey,
  readManifest,
  writeManifest,
  type Manifest,
  type ManifestEntry
} from './manifest'
import { pickVersion, planInstall, type Plan } from './resolver'
import type { ContentProvider, Version } from './types'

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

function checkDownloadUrl(url: string, fileName: string, hosts: string[]): void {
  let ok = false
  try {
    const u = new URL(url)
    ok = u.protocol === 'https:' && hosts.includes(u.hostname)
  } catch {
    ok = false
  }
  if (!ok) throw new AppError('CONTENT_SOURCE_API', `Unexpected download location for ${fileName}`)
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export interface ContentServiceDeps {
  store: Pick<ServerStore, 'get'>
  processes: Pick<ProcessManager, 'status'>
  providers: ContentProvider[]
  download: DownloadFn
  hashFile?: (path: string) => Promise<string>
  /** File operations used when replacing and removing jars; defaults to node's. */
  fsOps?: { rename?: typeof rename; rm?: typeof rm }
}

interface Ctx {
  rec: ServerRecord
  target: ContentTarget
  folder: string
  label: string
}

export class ContentService {
  private readonly deps: ContentServiceDeps
  private readonly providers: Map<ContentSource, ContentProvider>
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(deps: ContentServiceDeps) {
    this.deps = deps
    this.providers = new Map(deps.providers.map((p) => [p.id, p]))
  }

  private provider(source: ContentSource): ContentProvider {
    const p = this.providers.get(source)
    if (!p) {
      throw new AppError(
        'CONTENT_NOT_SUPPORTED',
        `${CONTENT_SOURCE_LABELS[source]} is not available.`
      )
    }
    return p
  }

  /** Not queued: it only reads the manifest, so it must not wait behind a slow install. */
  async search(serverId: string, query: string, offset: number): Promise<ContentSearchResult> {
    const { rec, target } = this.ctx(serverId)
    const manifest = await readManifest(rec.dir)
    const installed = new Set(
      manifest.entries.filter((e) => e.source === 'modrinth').map((e) => e.projectId)
    )
    const r = await this.provider('modrinth').search({
      target,
      mcVersion: rec.mcVersion,
      text: query,
      category: null,
      sort: 'relevance',
      offset,
      limit: 20
    })
    return {
      total: r.total,
      hits: r.hits.map((h) => ({
        projectId: h.projectId,
        slug: h.slug,
        title: h.title,
        description: h.description,
        iconUrl: h.iconUrl,
        downloads: h.downloads,
        installed: installed.has(h.projectId)
      }))
    }
  }

  listInstalled(serverId: string): Promise<InstalledContentList> {
    return this.serial(serverId, async () => {
      const { rec, target, folder } = this.ctx(serverId)
      const hashFile = this.deps.hashFile ?? sha1File
      const files = await this.jarFiles(folder)
      const manifest = await readManifest(rec.dir)
      const shas = new Map<string, string>()
      for (const f of files) shas.set(f, await hashFile(join(folder, f)))

      // An empty stored sha1 (a source without sha1) counts as known; the computed hash fills it in.
      const known = manifest.entries
        .filter((e) => e.sha1 === '' || shas.get(e.fileName) === e.sha1)
        .map((e) => (e.sha1 === '' ? { ...e, sha1: shas.get(e.fileName) ?? '' } : e))
      const knownNames = new Set(known.map((e) => e.fileName))
      const unknown = files.filter((f) => !knownNames.has(f))
      const entries = [...known]
      let offline = false

      if (unknown.length) {
        try {
          const found = await this.provider('modrinth').identify!(unknown.map((f) => shas.get(f)!))
          for (const f of unknown) {
            const v = found[shas.get(f)!]
            if (!v) continue
            entries.push({
              fileName: f,
              source: 'modrinth',
              projectId: v.projectId,
              versionId: v.versionId,
              title: v.title,
              versionNumber: v.versionNumber,
              iconUrl: v.iconUrl,
              sha1: shas.get(f)!,
              dependencyOf: [],
              disabled: false,
              explicit: true,
              installedAt: new Date().toISOString()
            })
          }
        } catch (err) {
          if (!isSourceDown(err)) throw err
          offline = true
        }
      }

      if (!sameEntries(entries, manifest.entries))
        await writeManifest(rec.dir, { ...manifest, entries })

      let updates: Record<string, Version> = {}
      const mr = entries.filter((e) => e.source === 'modrinth')
      if (!offline && mr.length) {
        try {
          updates = await this.provider('modrinth').latest!(
            mr.map((e) => e.sha1),
            target,
            rec.mcVersion,
            manifest.includeBeta
          )
        } catch (err) {
          if (!isSourceDown(err)) throw err
          offline = true
        }
      }

      const byName = new Map(entries.map((e) => [e.fileName, e]))
      const titleOf = new Map(entries.map((e) => [entryKey(e), e.title]))
      const items: InstalledContent[] = files.map((f) => {
        const e = byName.get(f)
        if (!e)
          return { fileName: f, title: f, versionNumber: null, source: 'manual', neededBy: [] }
        const u = updates[e.sha1]
        return {
          fileName: f,
          title: e.title,
          versionNumber: e.versionNumber,
          source: e.source,
          projectId: e.projectId,
          ...(u && u.id !== e.versionId
            ? { update: { versionId: u.id, versionNumber: u.versionNumber } }
            : {}),
          neededBy: e.dependencyOf.filter((k) => titleOf.has(k)).map((k) => titleOf.get(k)!)
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
      const provider = this.provider('modrinth')
      const plan = await this.planFor(c, provider, manifest, projectIdOrSlug)
      const wrote = await this.apply(c, provider, manifest, plan, null)
      return this.result(c, plan, wrote)
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
      const provider = this.provider(entry.source)
      const latest = await this.newestFor(c, provider, entry, manifest.includeBeta)
      if (!latest) return { installed: [], restartNeeded: false }

      // Exclude every manifest entry for this project (not just the one being updated) so the
      // resolver doesn't mistake the project for already installed and skip it entirely.
      const forPlan: Manifest = {
        ...manifest,
        entries: manifest.entries.filter((e) => entryKey(e) !== entryKey(entry))
      }
      const plan = await this.planFor(c, provider, forPlan, entry.projectId, latest.id)
      if (plan.items[0]?.projectId !== entry.projectId) {
        throw new AppError(
          'CONTENT_NO_COMPATIBLE_VERSION',
          `No compatible update was found for ${entry.title}.`
        )
      }

      // Only drop the entry being replaced, so a duplicate entry for the same project
      // (e.g. a second jar for the same mod) is left alone.
      const base: Manifest = { ...manifest, entries: manifest.entries.filter((e) => e !== entry) }
      const wrote = await this.apply(c, provider, base, plan, entry)
      return this.result(c, plan, wrote)
    })
  }

  remove(serverId: string, fileName: string): Promise<void> {
    return this.serial(serverId, async () => {
      const c = this.ctx(serverId)
      this.requireStopped(c)
      const name = safeFileName(fileName)
      await (this.deps.fsOps?.rm ?? rm)(join(c.folder, name), { force: true })
      const manifest = await readManifest(c.rec.dir)
      const entries = manifest.entries.filter((e) => e.fileName !== name)
      if (entries.length !== manifest.entries.length)
        await writeManifest(c.rec.dir, { ...manifest, entries })
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

  private planFor(
    c: Ctx,
    provider: ContentProvider,
    manifest: Manifest,
    projectIdOrSlug: string,
    versionId?: string
  ): Promise<Plan> {
    return planInstall(
      projectIdOrSlug,
      {
        provider,
        target: c.target,
        mcVersion: c.rec.mcVersion,
        installedProjectIds: new Set(
          manifest.entries.filter((e) => e.source === provider.id).map((e) => e.projectId)
        ),
        includeBeta: manifest.includeBeta,
        targetLabel: c.label
      },
      versionId
    )
  }

  /** Newest compatible version for one entry, or null when it is current/unknown. */
  private async newestFor(
    c: Ctx,
    provider: ContentProvider,
    entry: ManifestEntry,
    includeBeta: boolean
  ): Promise<Version | null> {
    let v: Version | null
    if (provider.latest) {
      v =
        (await provider.latest([entry.sha1], c.target, c.rec.mcVersion, includeBeta))[entry.sha1] ??
        null
    } else {
      v = pickVersion(
        await provider.versions(entry.projectId, c.target, c.rec.mcVersion),
        includeBeta
      )
    }
    return v && v.id !== entry.versionId ? v : null
  }

  /**
   * Downloads the plan; `replacing` is the entry an update supersedes.
   *
   * Dependencies (plan index > 0) are downloaded before the root item (index 0), so a
   * dependency failure never touches a file already on disk. An update always downloads the
   * root to a temporary file and renames it into place only once every download and the
   * stopped re-check have succeeded, so a failed update never destroys or corrupts a jar
   * that was there before (including one whose name differs only in case, which is the same
   * file on Windows). Rollback only deletes files this call created. Returns true if any
   * file was actually written to disk.
   */
  private async apply(
    c: Ctx,
    provider: ContentProvider,
    manifest: Manifest,
    { items: plan, links }: Plan,
    replacing: ManifestEntry | null
  ): Promise<boolean> {
    if (plan.length === 0) return false
    const fs = { rename: this.deps.fsOps?.rename ?? rename, rm: this.deps.fsOps?.rm ?? rm }
    const names = plan.map((item) => safeFileName(item.file.filename))
    plan.forEach((item, i) => checkDownloadUrl(item.file.url, names[i], provider.downloadHosts))
    const rootName = names[0]
    const rootDest = join(c.folder, rootName)
    const tempDest = `${rootDest}.blockhost-update`
    const created: string[] = []
    const rollback = async (): Promise<void> => {
      // Each file independently: one that cannot be removed must not keep the rest around.
      for (const file of created) await fs.rm(file, { force: true }).catch(() => {})
    }

    try {
      for (let i = 1; i < plan.length; i++) {
        const dest = join(c.folder, names[i])
        if (await pathExists(dest)) continue
        await this.deps.download({
          url: plan[i].file.url,
          dest,
          hash: plan[i].file.hash ?? undefined,
          allowedHosts: provider.downloadHosts
        })
        created.push(dest)
      }

      // An update always fetches a fresh root file; a plain install skips it if already present.
      if (replacing) {
        await this.deps.download({
          url: plan[0].file.url,
          dest: tempDest,
          hash: plan[0].file.hash ?? undefined,
          allowedHosts: provider.downloadHosts
        })
        created.push(tempDest)
        // The server may have started while these downloads were in flight; re-check right
        // before touching the old file so a race never leaves it replaced while running.
        this.requireStopped(c)
      } else if (!(await pathExists(rootDest))) {
        await this.deps.download({
          url: plan[0].file.url,
          dest: rootDest,
          hash: plan[0].file.hash ?? undefined,
          allowedHosts: provider.downloadHosts
        })
        created.push(rootDest)
      }
    } catch (err) {
      await rollback()
      throw err
    }

    let oldFileError = false
    if (replacing) {
      try {
        await fs.rename(tempDest, rootDest)
      } catch (err) {
        await rollback()
        throw new AppError(
          'CONTENT_IO',
          `Could not replace ${rootName}: ${errorMessage(err)}. Try again.`
        )
      }
      const oldName = replacing.fileName
      // On a case-insensitive file system a case-only rename already replaced the old file;
      // only delete it when it is a different file, or still listed under its old spelling.
      const removeOld =
        oldName !== rootName &&
        (oldName.toLowerCase() !== rootName.toLowerCase() ||
          (await readdir(c.folder)).includes(oldName))
      if (removeOld) {
        try {
          await fs.rm(join(c.folder, oldName), { force: true })
        } catch {
          oldFileError = true
        }
      }
    }

    const key = (projectId: string): string => `${provider.id}:${projectId}`
    const entries = manifest.entries
      .filter((e) => !names.includes(e.fileName))
      .map((e) => {
        if (e.source !== provider.id) return e
        const parents = links
          .filter((l) => l.projectId === e.projectId && !e.dependencyOf.includes(key(l.parentId)))
          .map((l) => key(l.parentId))
        return parents.length
          ? { ...e, dependencyOf: [...new Set([...e.dependencyOf, ...parents])] }
          : e
      })
    const now = new Date().toISOString()
    plan.forEach((item, i) =>
      entries.push({
        fileName: names[i],
        source: provider.id,
        projectId: item.projectId,
        versionId: item.versionId,
        title: item.title,
        versionNumber: item.versionNumber,
        iconUrl: item.iconUrl,
        sha1: item.file.sha1 ?? '',
        dependencyOf: i === 0 && replacing ? replacing.dependencyOf : item.dependencyOf.map(key),
        disabled: false,
        explicit: i === 0 ? (replacing ? replacing.explicit : true) : false,
        installedAt: i === 0 && replacing ? replacing.installedAt : now
      })
    )
    await writeManifest(c.rec.dir, { ...manifest, entries })
    if (oldFileError) {
      throw new AppError(
        'CONTENT_IO',
        `Updated ${plan[0].title}, but could not remove the old file ${replacing!.fileName}. Delete it by hand before starting the server.`
      )
    }
    return created.length > 0
  }

  private result(c: Ctx, plan: Plan, wrote: boolean): ContentInstallResult {
    return {
      installed: plan.items.map((item, i) => ({
        title: item.title,
        versionNumber: item.versionNumber,
        asDependency: i > 0
      })),
      restartNeeded: wrote && this.isUp(c.rec.id)
    }
  }

  private async jarFiles(folder: string): Promise<string[]> {
    try {
      const entries = await readdir(folder, { withFileTypes: true })
      return entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.jar'))
        .map((e) => e.name)
        .sort()
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

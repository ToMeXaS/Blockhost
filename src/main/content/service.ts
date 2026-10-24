import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  CONTENT_SOURCE_LABELS,
  SERVER_TYPE_LABELS,
  type ContentInstallResult,
  type ContentOrphan,
  type ContentPlanView,
  type ContentProjectView,
  type ContentRef,
  type ContentSearchRequest,
  type ContentSearchResult,
  type ContentUpdateAllResult,
  type ContentVersionView,
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
import { searchAll } from './search'
import type { ContentProvider, ProjectInfo, Version } from './types'

const DISABLED = '.disabled'
const PROJECT_TTL_MS = 5 * 60 * 1000

interface JarFile {
  /** Name on disk, including any ".disabled" suffix. */
  disk: string
  /** Name without the suffix; what the manifest and the UI use. */
  name: string
  disabled: boolean
}

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

async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** Entries that only existed to serve `removedKey` (directly or through other orphans). */
export function findOrphans(entries: ManifestEntry[], removedKey: string): ManifestEntry[] {
  const gone = new Set([removedKey])
  const orphans: ManifestEntry[] = []
  let changed = true
  while (changed) {
    changed = false
    for (const e of entries) {
      const key = entryKey(e)
      if (gone.has(key) || e.explicit || e.dependencyOf.length === 0) continue
      if (e.dependencyOf.every((k) => gone.has(k))) {
        gone.add(key)
        orphans.push(e)
        changed = true
      }
    }
  }
  return orphans
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export interface ContentServiceDeps {
  store: Pick<ServerStore, 'get'>
  processes: Pick<ProcessManager, 'status'>
  providers: ContentProvider[]
  download: DownloadFn
  /** Called with the number of available updates after every installed-list refresh. */
  onUpdates?: (serverId: string, count: number) => void
  hashFile?: (path: string) => Promise<string>
  /** File operations used when replacing and removing jars; defaults to node's. */
  fsOps?: { rename?: typeof rename; rm?: typeof rm }
  now?: () => number
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
  private readonly projectCache = new Map<string, { at: number; info: ProjectInfo }>()
  private readonly now: () => number

  constructor(deps: ContentServiceDeps) {
    this.deps = deps
    this.now = deps.now ?? Date.now
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

  sources(serverId: string): { source: ContentSource; label: string }[] {
    const { target } = this.ctx(serverId)
    return [...this.providers.values()]
      .filter((p) => p.supports(target))
      .map((p) => ({ source: p.id, label: p.label }))
  }

  /** Not queued: it only reads the manifest, so it must not wait behind a slow install. */
  async search(serverId: string, req: ContentSearchRequest): Promise<ContentSearchResult> {
    const { rec, target } = this.ctx(serverId)
    const manifest = await readManifest(rec.dir)
    const installed = new Set(manifest.entries.map(entryKey))
    const providers = [...this.providers.values()].filter(
      (p) => p.supports(target) && req.sources.includes(p.id)
    )
    const r = await searchAll(
      providers,
      { target, mcVersion: rec.mcVersion, text: req.text, category: req.category, sort: req.sort },
      req.cursor
    )
    return { ...r, hits: r.hits.map((h) => ({ ...h, installed: installed.has(entryKey(h)) })) }
  }

  private async info(provider: ContentProvider, idOrSlug: string): Promise<ProjectInfo> {
    const key = `${provider.id}:${idOrSlug}`
    const hit = this.projectCache.get(key)
    if (hit && this.now() - hit.at < PROJECT_TTL_MS) return hit.info
    const info = await provider.project(idOrSlug)
    this.projectCache.set(key, { at: this.now(), info })
    this.projectCache.set(`${provider.id}:${info.id}`, { at: this.now(), info })
    return info
  }

  async project(serverId: string, ref: ContentRef): Promise<ContentProjectView> {
    const { rec } = this.ctx(serverId)
    const provider = this.provider(ref.source)
    const info = await this.info(provider, ref.projectId)
    const entry = (await readManifest(rec.dir)).entries.find(
      (e) => e.source === ref.source && e.projectId === info.id
    )
    const { id, ...rest } = info
    return {
      ...rest,
      source: ref.source,
      projectId: id,
      installed: entry
        ? {
            fileName: entry.fileName,
            versionId: entry.versionId,
            versionNumber: entry.versionNumber
          }
        : null
    }
  }

  async versions(serverId: string, ref: ContentRef, all: boolean): Promise<ContentVersionView[]> {
    const { rec, target } = this.ctx(serverId)
    const provider = this.provider(ref.source)
    const { id } = await this.info(provider, ref.projectId)
    const compatible = await provider.versions(id, target, rec.mcVersion)
    const ok = new Set(compatible.map((v) => v.id))
    const list = all ? await provider.allVersions(id) : compatible
    return list.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      channel: v.channel,
      publishedAt: v.publishedAt,
      mcVersions: v.mcVersions,
      compatible: ok.has(v.id),
      downloadable: v.file.url !== null,
      externalUrl: v.file.externalUrl
    }))
  }

  async plan(serverId: string, ref: ContentRef, versionId?: string): Promise<ContentPlanView> {
    const c = this.ctx(serverId)
    const provider = this.provider(ref.source)
    const manifest = await readManifest(c.rec.dir)
    const plan = await this.planFor(c, provider, manifest, ref.projectId, versionId)
    const optional = await Promise.all(
      plan.optional.map(
        async (pid) => (await this.info(provider, pid).catch(() => null))?.title ?? pid
      )
    )
    return {
      install: plan.items.map((i, n) => ({
        title: i.title,
        versionNumber: i.versionNumber,
        asDependency: n > 0
      })),
      manual: plan.manual.map(({ title, externalUrl }) => ({ title, externalUrl })),
      optional
    }
  }

  listInstalled(serverId: string): Promise<InstalledContentList> {
    return this.serial(serverId, async () => {
      const { rec, target, folder } = this.ctx(serverId)
      const hashFile = this.deps.hashFile ?? sha1File
      const files = await this.jarFiles(folder)
      const manifest = await readManifest(rec.dir)
      const shas = new Map<string, string>()
      for (const f of files) shas.set(f.name, await hashFile(join(folder, f.disk)))
      const onDisk = new Map(files.map((f) => [f.name, f]))

      // An empty stored sha1 (a source without sha1) counts as known; the computed hash fills it in.
      const known = manifest.entries
        .filter((e) => shas.has(e.fileName) && (e.sha1 === '' || shas.get(e.fileName) === e.sha1))
        .map((e) => ({
          ...(e.sha1 === '' ? { ...e, sha1: shas.get(e.fileName)! } : e),
          disabled: onDisk.get(e.fileName)!.disabled
        }))
      const knownNames = new Set(known.map((e) => e.fileName))
      const unknown = files.filter((f) => !knownNames.has(f.name))
      const entries: ManifestEntry[] = [...known]
      let identifyOffline = false

      if (unknown.length) {
        try {
          const found = await this.provider('modrinth').identify!(
            unknown.map((f) => shas.get(f.name)!)
          )
          for (const f of unknown) {
            const v = found[shas.get(f.name)!]
            if (!v) continue
            entries.push({
              fileName: f.name,
              source: 'modrinth',
              projectId: v.projectId,
              versionId: v.versionId,
              title: v.title,
              versionNumber: v.versionNumber,
              iconUrl: v.iconUrl,
              sha1: shas.get(f.name)!,
              dependencyOf: [],
              disabled: f.disabled,
              explicit: true,
              installedAt: new Date().toISOString()
            })
          }
        } catch (err) {
          if (!isSourceDown(err)) throw err
          identifyOffline = true
        }
      }

      if (!sameEntries(entries, manifest.entries))
        await writeManifest(rec.dir, { ...manifest, entries })

      const offline = new Set<ContentSource>(identifyOffline ? ['modrinth'] : [])
      const updates = new Map<string, Version>() // fileName -> newer version
      for (const provider of this.providers.values()) {
        const mine = entries.filter((e) => e.source === provider.id)
        if (!mine.length || offline.has(provider.id)) continue
        try {
          if (provider.latest) {
            const found = await provider.latest(
              mine.map((e) => e.sha1),
              target,
              rec.mcVersion,
              manifest.includeBeta
            )
            for (const e of mine) {
              const v = found[e.sha1]
              if (v && v.id !== e.versionId) updates.set(e.fileName, v)
            }
          } else {
            await mapLimit(mine, 4, async (e) => {
              const v = pickVersion(
                await provider.versions(e.projectId, target, rec.mcVersion),
                manifest.includeBeta
              )
              if (v && v.id !== e.versionId) updates.set(e.fileName, v)
            })
          }
        } catch (err) {
          if (!isSourceDown(err)) throw err
          offline.add(provider.id)
        }
      }

      const byName = new Map(entries.map((e) => [e.fileName, e]))
      const titleOf = new Map(entries.map((e) => [entryKey(e), e.title]))
      const items: InstalledContent[] = await Promise.all(
        files.map(async (f): Promise<InstalledContent> => {
          const e = byName.get(f.name)
          if (!e) {
            const mtime = (await stat(join(folder, f.disk))).mtime.toISOString()
            return {
              fileName: f.name,
              title: f.name,
              versionNumber: null,
              source: 'manual',
              iconUrl: null,
              disabled: f.disabled,
              isDependency: false,
              installedAt: mtime,
              neededBy: []
            }
          }
          const u = updates.get(e.fileName)
          return {
            fileName: f.name,
            title: e.title,
            versionNumber: e.versionNumber,
            source: e.source,
            projectId: e.projectId,
            iconUrl: e.iconUrl,
            disabled: f.disabled,
            isDependency: e.dependencyOf.length > 0,
            installedAt: e.installedAt,
            ...(u ? { update: { versionId: u.id, versionNumber: u.versionNumber } } : {}),
            neededBy: e.dependencyOf.filter((k) => titleOf.has(k)).map((k) => titleOf.get(k)!)
          }
        })
      )
      items.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
      this.deps.onUpdates?.(serverId, items.filter((i) => i.update).length)
      return { items, offline: [...offline], includeBeta: manifest.includeBeta }
    })
  }

  install(serverId: string, ref: ContentRef, versionId?: string): Promise<ContentInstallResult> {
    return this.serial(serverId, async () => {
      const c = this.ctx(serverId)
      const provider = this.provider(ref.source)
      const manifest = await readManifest(c.rec.dir)
      const plan = await this.planFor(c, provider, manifest, ref.projectId, versionId)
      const wrote = await this.apply(c, provider, manifest, plan, null)
      return this.result(c, plan, wrote)
    })
  }

  update(serverId: string, fileName: string): Promise<ContentInstallResult> {
    return this.serial(serverId, async () => {
      const c = this.ctx(serverId)
      this.requireStopped(c)
      return this.updateOne(c, fileName)
    })
  }

  updateAll(serverId: string): Promise<ContentUpdateAllResult> {
    return this.serial(serverId, async () => {
      const c = this.ctx(serverId)
      this.requireStopped(c)
      const manifest = await readManifest(c.rec.dir)
      const result: ContentUpdateAllResult = { updated: [], failed: [] }
      // Each update rewrites the manifest, so walk a snapshot and skip entries that are gone.
      for (const snap of manifest.entries) {
        const entry = (await readManifest(c.rec.dir)).entries.find(
          (e) => e.fileName === snap.fileName
        )
        if (!entry) continue
        let newer: Version | null
        try {
          newer = await this.newestFor(c, this.provider(entry.source), entry, manifest.includeBeta)
        } catch (err) {
          result.failed.push({ title: entry.title, message: errorMessage(err) })
          continue
        }
        if (!newer) continue
        try {
          await this.updateOne(c, entry.fileName)
          result.updated.push({
            title: entry.title,
            from: entry.versionNumber,
            to: newer.versionNumber
          })
        } catch (err) {
          result.failed.push({ title: entry.title, message: errorMessage(err) })
        }
      }
      return result
    })
  }

  orphansOf(serverId: string, fileName: string): Promise<ContentOrphan[]> {
    return this.serial(serverId, async () => {
      const { rec } = this.ctx(serverId)
      const name = safeFileName(fileName)
      const manifest = await readManifest(rec.dir)
      const entry = manifest.entries.find((e) => e.fileName === name)
      if (!entry) return []
      return findOrphans(manifest.entries, entryKey(entry)).map((e) => ({
        fileName: e.fileName,
        title: e.title
      }))
    })
  }

  /** Updates one jar. The caller holds the queue and has checked the server is stopped. */
  private async updateOne(c: Ctx, fileName: string): Promise<ContentInstallResult> {
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

    return this.keepingDisabled(c, name, async (setNewName) => {
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
      setNewName(safeFileName(plan.items[0].file.filename))
      const base: Manifest = {
        ...manifest,
        entries: manifest.entries.filter((e) => e !== entry)
      }
      const wrote = await this.apply(c, provider, base, plan, entry)
      return this.result(c, plan, wrote)
    })
  }

  /**
   * Runs an update of `name`. If that jar is disabled it is renamed to its enabled name first
   * (the replace logic works on `.jar` files), and the new root jar is disabled again after the
   * update. `run` reports the new root file name through `setNewName` before it writes anything.
   * On failure the old jar goes back to `.disabled`, and so does the new root jar if the update
   * got as far as installing it (it only half succeeded). The server is stopped.
   */
  private async keepingDisabled<T>(
    c: Ctx,
    name: string,
    run: (setNewName: (newName: string) => void) => Promise<T>
  ): Promise<T> {
    const doRename = this.deps.fsOps?.rename ?? rename
    const on = join(c.folder, name)
    const off = `${on}${DISABLED}`
    let newName = name
    const setNewName = (n: string): void => {
      newName = n
    }
    const wasDisabled = (await pathExists(off)) && !(await pathExists(on))
    if (!wasDisabled) return run(setNewName)
    await doRename(off, on)

    const disableNew = async (): Promise<void> => {
      const next = join(c.folder, newName)
      await doRename(next, `${next}${DISABLED}`)
      const manifest = await readManifest(c.rec.dir)
      await writeManifest(c.rec.dir, {
        ...manifest,
        entries: manifest.entries.map((e) =>
          e.fileName === newName ? { ...e, disabled: true } : e
        )
      })
    }

    let value: T
    try {
      value = await run(setNewName)
    } catch (err) {
      const problems: string[] = []
      if (newName !== name) {
        // The new jar is in place only if the manifest was already switched over to it.
        const manifest = await readManifest(c.rec.dir)
        const installed =
          manifest.entries.some((e) => e.fileName === newName) &&
          !manifest.entries.some((e) => e.fileName === name)
        if (installed) {
          await disableNew().catch(() => problems.push(newName))
        }
      }
      if (await pathExists(on)) {
        await doRename(on, off).catch(() => problems.push(name))
      }
      if (problems.length && err instanceof AppError) {
        throw new AppError(
          err.code,
          `${err.message} Also could not re-disable ${problems.join(' and ')}; disable ${problems.length > 1 ? 'them' : 'it'} before starting the server.`,
          err.details
        )
      }
      throw err
    }
    await disableNew()
    return value
  }

  setEnabled(serverId: string, fileName: string, enabled: boolean): Promise<void> {
    return this.serial(serverId, async () => {
      const c = this.ctx(serverId)
      this.requireStopped(c)
      const name = safeFileName(fileName)
      const on = join(c.folder, name)
      const off = `${on}${DISABLED}`
      const [from, to] = enabled ? [off, on] : [on, off]
      if (!(await pathExists(from))) {
        if (await pathExists(to)) return // already in the requested state
        throw new AppError('NOT_FOUND', `${name} is not installed.`)
      }
      if (await pathExists(to)) {
        throw new AppError(
          'CONTENT_FILE_EXISTS',
          `${basename(to)} already exists. Remove one of the two files first.`
        )
      }
      await (this.deps.fsOps?.rename ?? rename)(from, to)
      const manifest = await readManifest(c.rec.dir)
      if (manifest.entries.some((e) => e.fileName === name)) {
        await writeManifest(c.rec.dir, {
          ...manifest,
          entries: manifest.entries.map((e) =>
            e.fileName === name ? { ...e, disabled: !enabled } : e
          )
        })
      }
    })
  }

  setIncludeBeta(serverId: string, value: boolean): Promise<void> {
    return this.serial(serverId, async () => {
      const { rec } = this.ctx(serverId)
      const manifest = await readManifest(rec.dir)
      if (manifest.includeBeta !== value)
        await writeManifest(rec.dir, { ...manifest, includeBeta: value })
    })
  }

  remove(
    serverId: string,
    fileName: string,
    opts: { removeOrphans?: boolean } = {}
  ): Promise<void> {
    return this.serial(serverId, async () => {
      const c = this.ctx(serverId)
      this.requireStopped(c)
      const name = safeFileName(fileName)
      const rmFile = this.deps.fsOps?.rm ?? rm
      await rmFile(join(c.folder, name), { force: true })
      await rmFile(join(c.folder, `${name}${DISABLED}`), { force: true })
      const manifest = await readManifest(c.rec.dir)
      const removed = manifest.entries.find((e) => e.fileName === name)
      const orphans =
        opts.removeOrphans && removed ? findOrphans(manifest.entries, entryKey(removed)) : []
      for (const o of orphans) {
        const orphanName = safeFileName(o.fileName)
        await rmFile(join(c.folder, orphanName), { force: true })
        await rmFile(join(c.folder, `${orphanName}${DISABLED}`), { force: true })
      }
      const gone = new Set([name, ...orphans.map((o) => o.fileName)])
      const entries = manifest.entries.filter((e) => !gone.has(e.fileName))
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
          expectZip: true,
          expectedSize: plan[i].file.hash ? undefined : (plan[i].file.size ?? undefined),
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
          expectZip: true,
          expectedSize: plan[0].file.hash ? undefined : (plan[0].file.size ?? undefined),
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
          expectZip: true,
          expectedSize: plan[0].file.hash ? undefined : (plan[0].file.size ?? undefined),
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
    // Sources without a sha1: record the hash of the jar actually on disk (downloaded or kept).
    const hashFile = this.deps.hashFile ?? sha1File
    const shas: string[] = []
    for (let i = 0; i < plan.length; i++) {
      shas.push(plan[i].file.sha1 ?? (await hashFile(join(c.folder, names[i]))))
    }
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
        sha1: shas[i],
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

  private async jarFiles(folder: string): Promise<JarFile[]> {
    let dirents
    try {
      dirents = await readdir(folder, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    return dirents
      .filter((e) => e.isFile())
      .flatMap((e): JarFile[] => {
        const lower = e.name.toLowerCase()
        if (lower.endsWith('.jar')) return [{ disk: e.name, name: e.name, disabled: false }]
        if (lower.endsWith(`.jar${DISABLED}`))
          return [{ disk: e.name, name: e.name.slice(0, -DISABLED.length), disabled: true }]
        return []
      })
      .sort((a, b) => a.name.localeCompare(b.name))
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

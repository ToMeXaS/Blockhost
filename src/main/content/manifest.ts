import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { CONTENT_SOURCES, type ContentSource } from '../../shared/types'
import { writeFileAtomic } from '../util/fs'

export interface ManifestEntry {
  /** As on disk, without a trailing ".disabled". */
  fileName: string
  source: ContentSource
  projectId: string
  versionId: string
  title: string
  versionNumber: string
  iconUrl: string | null
  sha1: string
  /** Keys ("source:projectId") of installed content that pulled this entry in. */
  dependencyOf: string[]
  disabled: boolean
  /** Installed directly (not only as somebody's dependency). */
  explicit: boolean
  installedAt: string
}

export interface Manifest {
  version: 2
  includeBeta: boolean
  entries: ManifestEntry[]
}

export const emptyManifest = (): Manifest => ({ version: 2, includeBeta: false, entries: [] })

export const entryKey = (e: { source: ContentSource; projectId: string }): string =>
  `${e.source}:${e.projectId}`

const V1_STRINGS = ['fileName', 'projectId', 'versionId', 'title', 'versionNumber', 'sha1'] as const

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((d) => typeof d === 'string')

function isV1Entry(
  value: unknown
): value is Omit<ManifestEntry, 'source' | 'iconUrl' | 'disabled' | 'explicit' | 'installedAt'> {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return V1_STRINGS.every((k) => typeof v[k] === 'string') && isStringArray(v.dependencyOf)
}

function isEntry(value: unknown): value is ManifestEntry {
  if (!isV1Entry(value)) return false
  const v = value as unknown as Record<string, unknown>
  return (
    (CONTENT_SOURCES as readonly string[]).includes(v.source as string) &&
    (v.iconUrl === null || typeof v.iconUrl === 'string') &&
    typeof v.disabled === 'boolean' &&
    typeof v.explicit === 'boolean' &&
    typeof v.installedAt === 'string'
  )
}

export function manifestPath(serverDir: string): string {
  return join(serverDir, '.blockhost', 'content.json')
}

export async function readManifest(serverDir: string): Promise<Manifest> {
  const path = manifestPath(serverDir)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    // Only a missing file means "nothing installed yet"; any other read error (locked,
    // permission denied...) must not be mistaken for an empty manifest and overwritten.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyManifest()
    throw err
  }
  let parsed: { version?: unknown; includeBeta?: unknown; entries?: unknown } | null
  try {
    parsed = JSON.parse(text) as typeof parsed
  } catch {
    return emptyManifest()
  }
  const raw = Array.isArray(parsed?.entries) ? (parsed.entries as unknown[]) : []
  if (parsed?.version === 2) {
    return {
      version: 2,
      includeBeta: parsed.includeBeta === true,
      entries: raw.filter(isEntry)
    }
  }
  // v1: Modrinth only, no icons/flags/dates.
  const installedAt = (await stat(path)).mtime.toISOString()
  return {
    version: 2,
    includeBeta: false,
    entries: raw.filter(isV1Entry).map((e) => ({
      fileName: e.fileName,
      source: 'modrinth' as const,
      projectId: e.projectId,
      versionId: e.versionId,
      title: e.title,
      versionNumber: e.versionNumber,
      iconUrl: null,
      sha1: e.sha1,
      dependencyOf: e.dependencyOf.map((p) => `modrinth:${p}`),
      disabled: false,
      explicit: e.dependencyOf.length === 0,
      installedAt
    }))
  }
}

export async function writeManifest(serverDir: string, manifest: Manifest): Promise<void> {
  await writeFileAtomic(manifestPath(serverDir), `${JSON.stringify(manifest, null, 2)}\n`)
}

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '../util/fs'

export interface ManifestEntry {
  fileName: string
  projectId: string
  versionId: string
  title: string
  versionNumber: string
  sha1: string
  /** Project ids of installed content that pulled this entry in as a dependency. */
  dependencyOf: string[]
}

export interface Manifest {
  version: 1
  entries: ManifestEntry[]
}

const STRING_FIELDS = [
  'fileName',
  'projectId',
  'versionId',
  'title',
  'versionNumber',
  'sha1'
] as const

function isEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    STRING_FIELDS.every((k) => typeof v[k] === 'string') &&
    Array.isArray(v.dependencyOf) &&
    v.dependencyOf.every((d) => typeof d === 'string')
  )
}

export function manifestPath(serverDir: string): string {
  return join(serverDir, '.blockhost', 'content.json')
}

export async function readManifest(serverDir: string): Promise<Manifest> {
  let text: string
  try {
    text = await readFile(manifestPath(serverDir), 'utf8')
  } catch (err) {
    // Only a missing file means "nothing installed yet"; any other read error (locked,
    // permission denied...) must not be mistaken for an empty manifest and overwritten.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: [] }
    throw err
  }
  let parsed: { entries?: unknown } | null
  try {
    parsed = JSON.parse(text) as { entries?: unknown } | null
  } catch {
    return { version: 1, entries: [] }
  }
  const entries = Array.isArray(parsed?.entries) ? parsed.entries.filter(isEntry) : []
  return { version: 1, entries }
}

export async function writeManifest(serverDir: string, manifest: Manifest): Promise<void> {
  await writeFileAtomic(manifestPath(serverDir), `${JSON.stringify(manifest, null, 2)}\n`)
}

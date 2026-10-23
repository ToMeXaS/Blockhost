import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { BackupInfo, BackupKind } from '../../shared/types'

const NAME_PATTERN = /^(\d{8})-(\d{6})-(manual|auto|pre-restore)\.zip$/
const SAFE_NAME = /^[^\\/:*?"<>|\x00-\x1f]{1,200}\.zip$/i

/** `20261023-090507-auto.zip`: UTC, second precision, sorts by time. */
export function backupFileName(date: Date, kind: BackupKind): string {
  const iso = date.toISOString()
  const stamp = `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}`
  return `${stamp}-${kind}.zip`
}

export function parseBackupFileName(name: string): { kind: BackupKind; createdAt: string } | null {
  const match = NAME_PATTERN.exec(name)
  if (!match) return null
  const [, d, t, kind] = match
  const createdAt = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}.000Z`
  const parsed = new Date(createdAt)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== createdAt) return null
  return { kind: kind as BackupKind, createdAt }
}

/** A plain basename (no folders or reserved characters) ending in .zip. */
export function isBackupFileName(name: string): boolean {
  return SAFE_NAME.test(name)
}

/**
 * The zips in `dir`, newest first. Hand-made zips count as manual, dated by mtime.
 * A missing folder is an empty list; any other read error is thrown.
 */
export async function listBackups(dir: string): Promise<BackupInfo[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const list: BackupInfo[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !isBackupFileName(entry.name)) continue
    let stats
    try {
      stats = await stat(join(dir, entry.name))
    } catch {
      continue // deleted mid-listing
    }
    const parsed = parseBackupFileName(entry.name)
    list.push({
      file: entry.name,
      kind: parsed?.kind ?? 'manual',
      createdAt: parsed?.createdAt ?? stats.mtime.toISOString(),
      bytes: stats.size
    })
  }
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.file.localeCompare(a.file))
}

/** Automatic backups past the newest `keep`, i.e. the ones to delete. */
export function pickPruned(list: BackupInfo[], keep: number): BackupInfo[] {
  return list
    .filter((b) => b.kind === 'auto')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(keep)
}

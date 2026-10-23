import { lstat, readdir, statfs } from 'node:fs/promises'
import { join, parse } from 'node:path'
import type { DiskUsage } from '../../shared/types'

/** Total size of regular files under dir. Skips symlinks/junctions and anything unreadable. */
export async function folderBytes(dir: string): Promise<number> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) total += await folderBytes(path)
    else if (entry.isFile()) {
      try {
        total += (await lstat(path)).size
      } catch {
        // Deleted or locked mid-walk.
      }
    }
  }
  return total
}

export async function diskUsage(dir: string): Promise<DiskUsage> {
  const root = parse(dir).root
  const [serverBytes, fs] = await Promise.all([folderBytes(dir), statfs(root)])
  return {
    serverBytes,
    freeBytes: fs.bavail * fs.bsize,
    totalBytes: fs.blocks * fs.bsize,
    drive: root.replace(/[\\/]+$/, '') || '/'
  }
}

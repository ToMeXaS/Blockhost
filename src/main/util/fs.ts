import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Writes to a temp file next to the target, then renames it over the target. */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, data, 'utf8')
  await rename(tmp, file)
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** True if the folder does not exist or contains nothing. False for files or non-empty folders. */
export async function isEmptyOrMissingDir(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

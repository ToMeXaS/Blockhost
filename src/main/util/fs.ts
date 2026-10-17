import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const RETRYABLE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const MAX_RENAME_ATTEMPTS = 5

function isRetryable(err: unknown): boolean {
  return RETRYABLE_CODES.has((err as NodeJS.ErrnoException).code ?? '')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Writes to a temp file next to the target, then renames it over the target.
 * On Windows the target may briefly be locked by a running process (e.g. a
 * Minecraft server holding server.properties open); retries the rename a
 * few times and, failing that, falls back to writing in place.
 */
export async function writeFileAtomic(
  file: string,
  data: string,
  fsOps: { rename?: typeof rename } = {}
): Promise<void> {
  const renameFn = fsOps.rename ?? rename
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, data, 'utf8')

  for (let attempt = 1; attempt <= MAX_RENAME_ATTEMPTS; attempt++) {
    try {
      await renameFn(tmp, file)
      return
    } catch (err) {
      if (!isRetryable(err)) {
        await rm(tmp, { force: true })
        throw err
      }
      if (attempt === MAX_RENAME_ATTEMPTS) {
        try {
          await writeFile(file, data, 'utf8')
        } catch (writeErr) {
          await rm(tmp, { force: true })
          throw writeErr
        }
        await rm(tmp, { force: true })
        return
      }
      await delay(50 * attempt)
    }
  }
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

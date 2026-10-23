import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { z } from 'zod'
import type { BackupMeta } from '../../shared/types'
import { AppError } from '../errors'
import {
  buildSchema,
  jvmArgSchema,
  nameSchema,
  portSchema,
  ramSchema,
  serverTypeSchema,
  versionSchema
} from '../schemas'

export const META_FILE = 'blockhost-backup.json'

const EXCLUDED_TOP = new Set(['logs', 'crash-reports', 'cache'])

/** True for paths (relative, `/`-separated) that never go into a backup. */
export function isExcluded(rel: string): boolean {
  const parts = rel.split('/')
  return (
    EXCLUDED_TOP.has(parts[0].toLowerCase()) ||
    parts[parts.length - 1].toLowerCase() === 'session.lock'
  )
}

/** Where a zip entry may be written; throws for names that would land outside `root`. */
export function safeTarget(root: string, name: string): string {
  const base = resolve(root)
  const unsafe = new AppError('BACKUP_INVALID', `Unsafe path in backup: ${name}`)
  if (name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw unsafe
  const target = resolve(base, name)
  if (target !== base && !target.startsWith(base + sep)) throw unsafe
  return target
}

/** Calls `onProgress` with whole percentages, once per change. */
function reporter(onProgress?: (percent: number) => void): (fraction: number) => void {
  let last = -1
  return (fraction) => {
    const percent = Math.min(100, Math.floor(fraction * 100))
    if (percent === last) return
    last = percent
    onProgress?.(percent)
  }
}

interface WalkEntry {
  rel: string
  abs: string
  size: number
  mtime: Date
  dir: boolean
}

/** Regular files and empty folders under `root`. Skips symlinks/junctions and exclusions. */
async function walk(root: string, rel: string, out: WalkEntry[]): Promise<void> {
  const abs = rel ? join(root, rel) : root
  const entries = await readdir(abs, { withFileTypes: true })
  if (rel && entries.length === 0) {
    out.push({ rel, abs, size: 0, mtime: (await lstat(abs)).mtime, dir: true })
  }
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (isExcluded(childRel)) continue
    if (entry.isDirectory()) await walk(root, childRel, out)
    else if (entry.isFile()) {
      const childAbs = join(root, childRel)
      const stats = await lstat(childAbs)
      out.push({ rel: childRel, abs: childAbs, size: stats.size, mtime: stats.mtime, dir: false })
    }
  }
}

/** Zips `src` into `dest` (via `dest.partial`, renamed when complete). */
export async function zipFolder(
  src: string,
  dest: string,
  opts: { meta: BackupMeta; onProgress?: (percent: number) => void }
): Promise<void> {
  const partial = `${dest}.partial`
  await mkdir(dirname(dest), { recursive: true })
  let zip: yazl.ZipFile | undefined
  try {
    const entries: WalkEntry[] = []
    await walk(src, '', entries)
    const total = entries.reduce((sum, e) => sum + e.size, 0)
    const report = reporter(opts.onProgress)
    let done = 0

    zip = new yazl.ZipFile()
    const output = zip.outputStream as Readable
    zip.on('error', (err: Error) => output.destroy(err))
    for (const entry of entries) {
      if (entry.dir) {
        zip.addEmptyDirectory(entry.rel, { mtime: entry.mtime })
        continue
      }
      zip.addReadStreamLazy(entry.rel, { mtime: entry.mtime }, (cb) => {
        const counter = new Transform({
          transform(chunk: Buffer, _encoding, next) {
            done += chunk.length
            report(total === 0 ? 1 : done / total)
            next(null, chunk)
          }
        })
        const input = createReadStream(entry.abs)
        input.on('error', (err) =>
          counter.destroy(
            new AppError('BACKUP_READ', `Could not read ${entry.rel}: ${err.message}`)
          )
        )
        cb(null, input.pipe(counter))
      })
    }
    zip.addBuffer(Buffer.from(JSON.stringify(opts.meta, null, 2)), META_FILE)
    zip.end()
    await pipeline(zip.outputStream, createWriteStream(partial))
    report(1)
    await rename(partial, dest)
  } catch (err) {
    ;(zip?.outputStream as Readable | undefined)?.destroy()
    await rm(partial, { force: true })
    throw err
  }
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) =>
      err || !zip ? reject(err ?? new Error('Could not open zip')) : resolvePromise(zip)
    )
  })
}

async function* eachEntry(zip: yauzl.ZipFile): AsyncGenerator<yauzl.Entry> {
  for (;;) {
    const entry = await new Promise<yauzl.Entry | null>((resolvePromise, reject) => {
      const cleanup = (): void => {
        zip.off('entry', onEntry)
        zip.off('end', onEnd)
        zip.off('error', onError)
      }
      const onEntry = (e: yauzl.Entry): void => {
        cleanup()
        resolvePromise(e)
      }
      const onEnd = (): void => {
        cleanup()
        resolvePromise(null)
      }
      const onError = (err: Error): void => {
        cleanup()
        reject(err)
      }
      zip.on('entry', onEntry)
      zip.on('end', onEnd)
      zip.on('error', onError)
      zip.readEntry()
    })
    if (!entry) return
    yield entry
  }
}

function openEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolvePromise, reject) => {
    zip.openReadStream(entry, (err, stream) =>
      err || !stream ? reject(err ?? new Error('Could not read zip entry')) : resolvePromise(stream)
    )
  })
}

/** Extracts `zipPath` into `destDir`, skipping the metadata file. */
export async function unzipTo(
  zipPath: string,
  destDir: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  const root = resolve(destDir)
  await mkdir(root, { recursive: true })
  const zip = await openZip(zipPath)
  const report = reporter(onProgress)
  try {
    let done = 0
    for await (const entry of eachEntry(zip)) {
      done++
      if (entry.fileName !== META_FILE) {
        const target = safeTarget(root, entry.fileName)
        if (entry.fileName.endsWith('/')) {
          await mkdir(target, { recursive: true })
        } else {
          await mkdir(dirname(target), { recursive: true })
          await pipeline(await openEntry(zip, entry), createWriteStream(target))
        }
      }
      report(done / Math.max(1, zip.entryCount))
    }
    report(1)
  } finally {
    zip.close()
  }
}

const metaSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  kind: z.enum(['manual', 'auto', 'pre-restore']),
  server: z.object({
    name: nameSchema,
    type: serverTypeSchema,
    mcVersion: versionSchema,
    build: buildSchema.optional(),
    ramMb: ramSchema,
    jvmArgs: z.array(jvmArgSchema).max(50),
    launch: z.object({ args: z.array(z.string()) }).optional(),
    port: portSchema
  })
})

/** The zip's blockhost-backup.json, or null if it is missing, invalid or the file isn't a zip. */
export async function readMeta(zipPath: string): Promise<BackupMeta | null> {
  let zip: yauzl.ZipFile
  try {
    zip = await openZip(zipPath)
  } catch {
    return null
  }
  try {
    for await (const entry of eachEntry(zip)) {
      if (entry.fileName !== META_FILE) continue
      const chunks: Buffer[] = []
      for await (const chunk of await openEntry(zip, entry)) chunks.push(chunk as Buffer)
      const parsed = metaSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      return parsed.success ? parsed.data : null
    }
    return null
  } catch {
    return null
  } finally {
    zip.close()
  }
}

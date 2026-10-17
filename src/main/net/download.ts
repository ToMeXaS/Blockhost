import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { AppError } from '../errors'
import { USER_AGENT } from './http'

export type HashAlgo = 'sha1' | 'sha256' | 'md5'

export interface DownloadOptions {
  url: string
  dest: string
  hash?: { algo: HashAlgo; value: string }
  onProgress?: (received: number, total: number | undefined) => void
  retries?: number
  retryDelayMs?: number
  fetchImpl?: typeof fetch
}

export type DownloadFn = (opts: DownloadOptions) => Promise<void>

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const downloadFile: DownloadFn = async (opts) => {
  const retries = opts.retries ?? 3
  const retryDelayMs = opts.retryDelayMs ?? 1000
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs * 2 ** (attempt - 1))
    try {
      await attemptDownload(opts)
      return
    } catch (err) {
      lastError = err
      await rm(`${opts.dest}.part`, { force: true })
    }
  }
  if (lastError instanceof AppError) throw lastError
  throw new AppError('DOWNLOAD_FAILED', `Download failed: ${(lastError as Error)?.message}`)
}

async function attemptDownload(opts: DownloadOptions): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(opts.url, { headers: { 'User-Agent': USER_AGENT } })
  } catch (err) {
    throw new AppError('NETWORK', `Could not download ${opts.url}: ${(err as Error).message}`)
  }
  if (!res.ok || !res.body) {
    throw new AppError('HTTP', `Download of ${opts.url} failed with HTTP ${res.status}`)
  }

  const total = Number(res.headers.get('content-length')) || undefined
  const part = `${opts.dest}.part`
  const hash = opts.hash ? createHash(opts.hash.algo) : null
  let received = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      hash?.update(chunk)
      opts.onProgress?.(received, total)
      callback(null, chunk)
    }
  })

  await mkdir(dirname(opts.dest), { recursive: true })
  await pipeline(
    Readable.fromWeb(res.body as unknown as WebReadableStream),
    meter,
    createWriteStream(part)
  )

  if (hash && opts.hash) {
    const actual = hash.digest('hex')
    if (actual.toLowerCase() !== opts.hash.value.toLowerCase()) {
      throw new AppError('HASH_MISMATCH', `Checksum mismatch for ${basename(opts.dest)}`)
    }
  }
  await rename(part, opts.dest)
}

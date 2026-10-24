import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pathExists } from '../util/fs'
import { tempDir } from '../test-utils'
import { downloadFile } from './download'

const body = Buffer.from('hello blockhost '.repeat(4096))
const sha256 = createHash('sha256').update(body).digest('hex')
let server: Server
let base: string
let flakyFailures = 0

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/missing') {
      res.statusCode = 404
      res.end()
      return
    }
    if (req.url === '/flaky' && flakyFailures > 0) {
      flakyFailures--
      res.statusCode = 500
      res.end()
      return
    }
    res.setHeader('content-length', String(body.length))
    res.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe('downloadFile', () => {
  it('downloads to dest, verifies the hash and reports progress', async () => {
    const dest = join(await tempDir(), 'sub', 'server.jar')
    const progress: number[] = []
    await downloadFile({
      url: `${base}/ok`,
      dest,
      hash: { algo: 'sha256', value: sha256.toUpperCase() },
      onProgress: (received, total) => {
        expect(total).toBe(body.length)
        progress.push(received)
      }
    })
    expect(await readFile(dest)).toEqual(body)
    expect(progress.at(-1)).toBe(body.length)
    expect(await pathExists(`${dest}.part`)).toBe(false)
  })

  it('rejects with HASH_MISMATCH and leaves no files behind', async () => {
    const dest = join(await tempDir(), 'server.jar')
    await expect(
      downloadFile({ url: `${base}/ok`, dest, hash: { algo: 'sha1', value: 'abc' }, retries: 0 })
    ).rejects.toMatchObject({ code: 'HASH_MISMATCH' })
    expect(await pathExists(dest)).toBe(false)
    expect(await pathExists(`${dest}.part`)).toBe(false)
  })

  it('retries failed attempts', async () => {
    flakyFailures = 2
    const dest = join(await tempDir(), 'server.jar')
    await downloadFile({ url: `${base}/flaky`, dest, retries: 3, retryDelayMs: 1 })
    expect(await readFile(dest)).toEqual(body)
  })

  it('gives up after the retry budget', async () => {
    const dest = join(await tempDir(), 'server.jar')
    await expect(
      downloadFile({ url: `${base}/missing`, dest, retries: 1, retryDelayMs: 1 })
    ).rejects.toMatchObject({ code: 'HTTP' })
  })

  it('refuses a download whose final URL is on another host, without retrying', async () => {
    const dir = await tempDir()
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      const res = new Response('PKdata')
      Object.defineProperty(res, 'url', { value: 'https://evil.example/x.jar' })
      return res
    }) as unknown as typeof fetch
    await expect(
      downloadFile({
        url: 'https://cdn.modrinth.com/x.jar',
        dest: join(dir, 'x.jar'),
        allowedHosts: ['cdn.modrinth.com'],
        fetchImpl,
        retryDelayMs: 1
      })
    ).rejects.toMatchObject({ code: 'DOWNLOAD_BLOCKED' })
    expect(calls).toBe(1)
  })

  it('accepts a redirect to an allowed host', async () => {
    const dir = await tempDir()
    const fetchImpl = (async () => {
      const res = new Response('jar')
      Object.defineProperty(res, 'url', { value: 'https://cdn.spiget.org/file/1.jar' })
      return res
    }) as unknown as typeof fetch
    await downloadFile({
      url: 'https://api.spiget.org/v2/resources/1/download',
      dest: join(dir, '1.jar'),
      allowedHosts: ['api.spiget.org', 'cdn.spiget.org'],
      fetchImpl
    })
  })

  it('rejects a non-zip when a jar is expected', async () => {
    const dir = await tempDir()
    const fetchImpl = (async () => new Response('<html>blocked</html>')) as unknown as typeof fetch
    await expect(
      downloadFile({
        url: 'https://cdn.spiget.org/x.jar',
        dest: join(dir, 'x.jar'),
        expectZip: true,
        fetchImpl,
        retries: 0
      })
    ).rejects.toMatchObject({ code: 'DOWNLOAD_INVALID' })
    expect(await readdir(dir)).toEqual([])
  })

  it('checks an exact size when given', async () => {
    const dir = await tempDir()
    const fetchImpl = (async () => new Response('PK\u0003\u0004abc')) as unknown as typeof fetch
    await expect(
      downloadFile({
        url: 'https://cdn.spiget.org/x.jar',
        dest: join(dir, 'x.jar'),
        expectZip: true,
        expectedSize: 99,
        fetchImpl,
        retries: 0
      })
    ).rejects.toMatchObject({ code: 'DOWNLOAD_INVALID' })
    await downloadFile({
      url: 'https://cdn.spiget.org/x.jar',
      dest: join(dir, 'y.jar'),
      expectZip: true,
      expectedSize: 7,
      fetchImpl,
      retries: 0
    })
  })
})

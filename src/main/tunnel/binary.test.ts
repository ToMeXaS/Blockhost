import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fakeDownload, tempDir } from '../test-utils'
import { PLAYITD_SHA256, PLAYITD_URL, PlayitdBinary, sha256File } from './binary'

describe('PlayitdBinary', () => {
  it('downloads the pinned release with its checksum when missing', async () => {
    const dir = await tempDir()
    const dl = fakeDownload()
    const binary = new PlayitdBinary({ dir, download: dl.fn, hashFile: async () => PLAYITD_SHA256 })
    const exe = await binary.ensure()
    expect(exe).toBe(join(dir, 'playitd-1.0.12.exe'))
    expect(dl.calls).toHaveLength(1)
    expect(dl.calls[0]).toMatchObject({
      url: PLAYITD_URL,
      dest: exe,
      hash: { algo: 'sha256', value: PLAYITD_SHA256 }
    })
  })

  it('reuses a cached file whose hash matches', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'playitd-1.0.12.exe'), 'cached')
    const dl = fakeDownload()
    const binary = new PlayitdBinary({ dir, download: dl.fn, hashFile: async () => PLAYITD_SHA256 })
    await binary.ensure()
    expect(dl.calls).toHaveLength(0)
    expect(await readFile(binary.path(), 'utf8')).toBe('cached')
  })

  it('replaces a cached file whose hash does not match', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'playitd-1.0.12.exe'), 'tampered')
    const dl = fakeDownload()
    const binary = new PlayitdBinary({ dir, download: dl.fn, hashFile: async () => 'deadbeef' })
    await binary.ensure()
    expect(dl.calls).toHaveLength(1)
    expect(await readFile(binary.path(), 'utf8')).toBe('x')
  })

  it('reports progress as a percentage and shares one download between callers', async () => {
    const dir = await tempDir()
    const download = vi.fn(
      async (opts: { onProgress?: (r: number, t?: number) => void; dest: string }) => {
        opts.onProgress?.(50, 200)
        opts.onProgress?.(200, 200)
        await writeFile(opts.dest, 'x')
      }
    )
    const binary = new PlayitdBinary({ dir, download, hashFile: async () => PLAYITD_SHA256 })
    const progress: number[] = []
    await Promise.all([binary.ensure((p) => progress.push(p)), binary.ensure()])
    expect(download).toHaveBeenCalledTimes(1)
    expect(progress).toEqual([25, 100])
  })
})

describe('sha256File', () => {
  it('hashes file contents', async () => {
    const file = join(await tempDir(), 'f')
    await writeFile(file, 'abc')
    expect(await sha256File(file)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})

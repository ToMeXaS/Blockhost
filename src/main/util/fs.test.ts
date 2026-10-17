import { rename as realRename } from 'node:fs/promises'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { tempDir } from '../test-utils'
import { isEmptyOrMissingDir, pathExists, writeFileAtomic } from './fs'

describe('writeFileAtomic', () => {
  it('creates parent folders, replaces content and leaves no temp files', async () => {
    const dir = await tempDir()
    const file = join(dir, 'a', 'b.json')
    await writeFileAtomic(file, 'one')
    await writeFileAtomic(file, 'two')
    expect(await readFile(file, 'utf8')).toBe('two')
    expect(await readdir(join(dir, 'a'))).toEqual(['b.json'])
  })

  it('retries the rename on a Windows file lock and succeeds once the lock clears', async () => {
    const dir = await tempDir()
    const file = join(dir, 'server.properties')
    await writeFile(file, 'old', 'utf8')
    let calls = 0
    const rename = vi.fn(
      async (tmp: Parameters<typeof realRename>[0], dest: Parameters<typeof realRename>[1]) => {
        calls++
        if (calls < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' })
        return realRename(tmp, dest)
      }
    )

    await writeFileAtomic(file, 'new', { rename })

    expect(await readFile(file, 'utf8')).toBe('new')
    expect(calls).toBe(3)
    expect(await readdir(dir)).toEqual(['server.properties'])
  })

  it('falls back to an in-place write when the rename keeps failing with a lock error', async () => {
    const dir = await tempDir()
    const file = join(dir, 'server.properties')
    await writeFile(file, 'old', 'utf8')
    const rename = vi.fn(async () => {
      throw Object.assign(new Error('locked'), { code: 'EPERM' })
    })

    await writeFileAtomic(file, 'new', { rename })

    expect(await readFile(file, 'utf8')).toBe('new')
    expect(await readdir(dir)).toEqual(['server.properties'])
  })

  it('rethrows a non-retryable rename error and leaves no temp file behind', async () => {
    const dir = await tempDir()
    const file = join(dir, 'server.properties')
    await writeFile(file, 'old', 'utf8')
    const rename = vi.fn(async () => {
      throw Object.assign(new Error('no space'), { code: 'ENOSPC' })
    })

    await expect(writeFileAtomic(file, 'new', { rename })).rejects.toMatchObject({ code: 'ENOSPC' })

    expect(await readFile(file, 'utf8')).toBe('old')
    expect(await readdir(dir)).toEqual(['server.properties'])
  })
})

describe('pathExists / isEmptyOrMissingDir', () => {
  it('reports existence and emptiness', async () => {
    const dir = await tempDir()
    expect(await pathExists(dir)).toBe(true)
    expect(await pathExists(join(dir, 'nope'))).toBe(false)
    expect(await isEmptyOrMissingDir(join(dir, 'nope'))).toBe(true)
    expect(await isEmptyOrMissingDir(dir)).toBe(true)
    await writeFile(join(dir, 'x.txt'), '')
    expect(await isEmptyOrMissingDir(dir)).toBe(false)
    expect(await isEmptyOrMissingDir(join(dir, 'x.txt'))).toBe(false)
  })
})

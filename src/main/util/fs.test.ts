import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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

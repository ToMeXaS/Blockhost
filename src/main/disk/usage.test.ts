import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../test-utils'
import { diskUsage, folderBytes } from './usage'

describe('folderBytes', () => {
  it('adds up files in nested folders', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.txt'), 'x'.repeat(100))
    await mkdir(join(dir, 'world', 'region'), { recursive: true })
    await writeFile(join(dir, 'world', 'level.dat'), 'x'.repeat(20))
    await writeFile(join(dir, 'world', 'region', 'r.0.0.mca'), 'x'.repeat(3))
    expect(await folderBytes(dir)).toBe(123)
  })

  it('does not follow symlinks or junctions', async () => {
    const dir = await tempDir()
    const outside = await tempDir()
    await writeFile(join(outside, 'big.bin'), 'x'.repeat(500))
    await writeFile(join(dir, 'a.txt'), 'x'.repeat(10))
    await symlink(outside, join(dir, 'link'), 'junction')
    expect(await folderBytes(dir)).toBe(10)
  })

  it('returns 0 for a missing folder', async () => {
    expect(await folderBytes(join(await tempDir(), 'nope'))).toBe(0)
  })
})

describe('diskUsage', () => {
  it('reports the folder size and the drive it lives on', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.txt'), 'x'.repeat(42))
    const usage = await diskUsage(dir)
    expect(usage.serverBytes).toBe(42)
    expect(usage.totalBytes).toBeGreaterThan(0)
    expect(usage.freeBytes).toBeGreaterThanOrEqual(0)
    expect(usage.freeBytes).toBeLessThanOrEqual(usage.totalBytes)
    expect(usage.drive).toMatch(/^[A-Z]:$|^\/$/)
  })
})

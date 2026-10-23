import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../test-utils'
import { countChunks, scanWorlds } from './scan'

/** A region file whose location table marks `chunks` chunks as generated. */
function region(chunks: number, extraBytes = 0): Buffer {
  const buf = Buffer.alloc(4096 + extraBytes)
  for (let i = 0; i < chunks; i++) buf.writeUInt32BE(0x00000201, i * 4)
  return buf
}

async function put(path: string, data: Buffer | string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, data)
}

describe('countChunks', () => {
  it('counts generated chunks across region files and ignores other files', async () => {
    const dir = await tempDir()
    await put(join(dir, 'r.0.0.mca'), region(3))
    await put(join(dir, 'r.0.1.mca'), region(2))
    await put(join(dir, 'r.1.1.mca'), Buffer.alloc(0))
    await put(join(dir, 'notes.txt'), 'x'.repeat(5000))
    expect(await countChunks(dir)).toBe(5)
  })

  it('returns 0 for a missing folder', async () => {
    expect(await countChunks(join(await tempDir(), 'nope'))).toBe(0)
  })
})

describe('scanWorlds', () => {
  it('reads vanilla worlds with the nether and end nested inside the level', async () => {
    const dir = await tempDir()
    await put(join(dir, 'world', 'region', 'r.0.0.mca'), region(4))
    await put(join(dir, 'world', 'DIM-1', 'region', 'r.0.0.mca'), region(2))
    await put(join(dir, 'world', 'DIM1', 'region', 'r.0.0.mca'), region(1))
    expect(await scanWorlds(dir)).toEqual([
      { dimension: 'overworld', folder: 'world', bytes: 4096, chunks: 4 },
      { dimension: 'nether', folder: 'world/DIM-1', bytes: 4096, chunks: 2 },
      { dimension: 'end', folder: 'world/DIM1', bytes: 4096, chunks: 1 }
    ])
  })

  it('reads the 26.x layout with every dimension under dimensions/minecraft', async () => {
    const dir = await tempDir()
    const dims = join(dir, 'world', 'dimensions', 'minecraft')
    await put(join(dims, 'overworld', 'region', 'r.0.0.mca'), region(6))
    await put(join(dims, 'the_nether', 'region', 'r.0.0.mca'), region(2))
    await put(join(dims, 'the_end', 'region', 'r.0.0.mca'), region(1))
    expect(await scanWorlds(dir)).toEqual([
      { dimension: 'overworld', folder: 'world', bytes: 4096, chunks: 6 },
      {
        dimension: 'nether',
        folder: 'world/dimensions/minecraft/the_nether',
        bytes: 4096,
        chunks: 2
      },
      { dimension: 'end', folder: 'world/dimensions/minecraft/the_end', bytes: 4096, chunks: 1 }
    ])
  })

  it('reads Paper sibling folders and honours level-name', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'server.properties'), 'level-name=survival\n')
    await put(join(dir, 'survival', 'region', 'r.0.0.mca'), region(5, 100))
    await put(join(dir, 'survival_nether', 'DIM-1', 'region', 'r.0.0.mca'), region(1))
    expect(await scanWorlds(dir)).toEqual([
      { dimension: 'overworld', folder: 'survival', bytes: 4196, chunks: 5 },
      { dimension: 'nether', folder: 'survival_nether', bytes: 4096, chunks: 1 }
    ])
  })

  it('returns nothing before the world has been generated', async () => {
    expect(await scanWorlds(await tempDir())).toEqual([])
  })
})

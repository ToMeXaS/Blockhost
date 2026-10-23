import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorldDimension, WorldInfo } from '../../shared/types'
import { folderBytes } from '../disk/usage'
import { readPropertiesFile } from '../servers/properties'

/** A region file starts with 1024 four-byte chunk locations; 0 means not generated. */
const LOCATION_TABLE_BYTES = 4096

const DIMENSION_DIRS: Record<Exclude<WorldDimension, 'overworld'>, string> = {
  nether: 'DIM-1',
  end: 'DIM1'
}

/** Paper and its forks keep each dimension in a sibling folder named after the level. */
const SIBLING_SUFFIX: Record<Exclude<WorldDimension, 'overworld'>, string> = {
  nether: '_nether',
  end: '_the_end'
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Generated chunks across every region file in a folder. */
export async function countChunks(regionDir: string): Promise<number> {
  let names: string[]
  try {
    names = await readdir(regionDir)
  } catch {
    return 0
  }
  let total = 0
  const table = Buffer.alloc(LOCATION_TABLE_BYTES)
  for (const name of names) {
    if (!name.endsWith('.mca')) continue
    let file
    try {
      file = await open(join(regionDir, name), 'r')
      const { bytesRead } = await file.read(table, 0, LOCATION_TABLE_BYTES, 0)
      for (let i = 0; i + 4 <= bytesRead; i += 4) {
        if (table.readUInt32BE(i) !== 0) total++
      }
    } catch {
      // Locked or deleted mid-scan; skip it.
    } finally {
      await file?.close()
    }
  }
  return total
}

/** Since 26.x each dimension lives in `<level>/dimensions/<namespace>/<name>`. */
const MODERN_DIRS: Record<WorldDimension, string> = {
  overworld: 'dimensions/minecraft/overworld',
  nether: 'dimensions/minecraft/the_nether',
  end: 'dimensions/minecraft/the_end'
}

/** The overworld, nether and end of a server's level, in that order, skipping missing ones. */
export async function scanWorlds(serverDir: string): Promise<WorldInfo[]> {
  const props = await readPropertiesFile(serverDir)
  const level = props.find((e) => e.key === 'level-name')?.value?.trim() || 'world'
  const levelDir = join(serverDir, level)
  if (!(await isDir(levelDir))) return []

  const others: WorldInfo[] = []
  let nestedBytes = 0
  for (const dimension of ['nether', 'end'] as const) {
    const sibling = `${level}${SIBLING_SUFFIX[dimension]}`
    const nested = [MODERN_DIRS[dimension], DIMENSION_DIRS[dimension]]
    const inside = await firstDir(levelDir, nested)
    if (await isDir(join(serverDir, sibling))) {
      const root = join(serverDir, sibling)
      others.push({
        dimension,
        folder: sibling,
        bytes: await folderBytes(root),
        chunks: await countChunks(join(root, DIMENSION_DIRS[dimension], 'region'))
      })
    } else if (inside) {
      const bytes = await folderBytes(join(levelDir, inside))
      nestedBytes += bytes
      others.push({
        dimension,
        folder: `${level}/${inside}`,
        bytes,
        chunks: await countChunks(join(levelDir, inside, 'region'))
      })
    }
  }

  const overworldDir = (await firstDir(levelDir, [MODERN_DIRS.overworld])) ?? ''
  const overworld: WorldInfo = {
    dimension: 'overworld',
    folder: level,
    bytes: Math.max(0, (await folderBytes(levelDir)) - nestedBytes),
    chunks: await countChunks(join(levelDir, overworldDir, 'region'))
  }
  return [overworld, ...others]
}

/** The first of `candidates` (relative to `base`) that is a folder. */
async function firstDir(base: string, candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await isDir(join(base, candidate))) return candidate
  }
  return undefined
}

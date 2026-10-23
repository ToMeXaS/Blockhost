import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BackupMeta } from '../../shared/types'
import { isExcluded, readMeta, safeTarget, unzipTo, zipFolder } from './archive'

const META: BackupMeta = {
  version: 1,
  createdAt: '2026-10-23T12:00:00.000Z',
  kind: 'manual',
  server: {
    name: 'Survival',
    type: 'paper',
    mcVersion: '1.21.4',
    build: '100',
    ramMb: 4096,
    jvmArgs: ['-XX:+UseG1GC'],
    launch: { args: ['-jar', 'server.jar'] },
    port: 25565
  }
}

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'blockhost-archive-'))
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function put(path: string, text: string) {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}

describe('isExcluded', () => {
  it('skips logs, crash reports, cache and session.lock anywhere', () => {
    expect(isExcluded('logs')).toBe(true)
    expect(isExcluded('logs/latest.log')).toBe(true)
    expect(isExcluded('crash-reports/x.txt')).toBe(true)
    expect(isExcluded('cache/mojang_1.21.jar')).toBe(true)
    expect(isExcluded('world/session.lock')).toBe(true)
    expect(isExcluded('session.lock')).toBe(true)
  })
  it('keeps everything else, including libraries and nested folders named logs', () => {
    expect(isExcluded('libraries/net/x.jar')).toBe(false)
    expect(isExcluded('world/level.dat')).toBe(false)
    expect(isExcluded('plugins/Foo/logs/a.txt')).toBe(false)
  })
})

describe('safeTarget', () => {
  it('resolves normal names inside the root', () => {
    expect(safeTarget(join(tmp, 'out'), 'world/level.dat')).toBe(
      join(tmp, 'out', 'world', 'level.dat')
    )
  })
  it('rejects names that escape the root', () => {
    expect(() => safeTarget(join(tmp, 'out'), '../evil.txt')).toThrow(/Unsafe path/)
    expect(() => safeTarget(join(tmp, 'out'), 'a/../../evil.txt')).toThrow(/Unsafe path/)
    expect(() => safeTarget(join(tmp, 'out'), '/etc/passwd')).toThrow(/Unsafe path/)
    expect(() => safeTarget(join(tmp, 'out'), 'C:/Windows/x')).toThrow(/Unsafe path/)
    expect(() => safeTarget(join(tmp, 'out'), 'a\\..\\..\\evil')).toThrow(/Unsafe path/)
  })
})

describe('zipFolder + unzipTo', () => {
  it('round-trips files and empty folders, minus exclusions', async () => {
    const src = join(tmp, 'server')
    await put(join(src, 'server.properties'), 'server-port=25565')
    await put(join(src, 'world', 'level.dat'), 'level')
    await put(join(src, 'world', 'session.lock'), 'lock')
    await put(join(src, 'libraries', 'a', 'b.jar'), 'jar')
    await put(join(src, 'logs', 'latest.log'), 'log')
    await mkdir(join(src, 'plugins', 'Empty'), { recursive: true })
    const zip = join(tmp, 'backups', 'b.zip')
    const progress: number[] = []

    await zipFolder(src, zip, { meta: META, onProgress: (p) => progress.push(p) })
    const out = join(tmp, 'restored')
    await unzipTo(zip, out)

    expect(await readFile(join(out, 'server.properties'), 'utf8')).toBe('server-port=25565')
    expect(await readFile(join(out, 'world', 'level.dat'), 'utf8')).toBe('level')
    expect(await readFile(join(out, 'libraries', 'a', 'b.jar'), 'utf8')).toBe('jar')
    expect(await readdir(join(out, 'plugins', 'Empty'))).toEqual([])
    expect((await readdir(out)).sort()).toEqual([
      'libraries',
      'plugins',
      'server.properties',
      'world'
    ])
    expect(await readdir(join(out, 'world'))).toEqual(['level.dat'])
    expect(progress.at(-1)).toBe(100)
    expect(await readdir(join(tmp, 'backups'))).toEqual(['b.zip'])
  })

  it('removes the partial file when the source folder is missing', async () => {
    const zip = join(tmp, 'backups', 'b.zip')
    await expect(zipFolder(join(tmp, 'nope'), zip, { meta: META })).rejects.toThrow()
    expect(await readdir(join(tmp, 'backups')).catch(() => [])).toEqual([])
  })
})

describe('readMeta', () => {
  it('reads the embedded metadata', async () => {
    const src = join(tmp, 'server')
    await put(join(src, 'a.txt'), 'a')
    const zip = join(tmp, 'b.zip')
    await zipFolder(src, zip, { meta: META })
    expect(await readMeta(zip)).toEqual(META)
  })

  it('returns null for a file that is not a zip', async () => {
    const zip = join(tmp, 'bad.zip')
    await writeFile(zip, 'not a zip')
    expect(await readMeta(zip)).toBeNull()
  })
})

describe('readMeta validation', () => {
  it('returns null when the metadata carries a forbidden JVM argument', async () => {
    const src = join(tmp, 'server')
    await put(join(src, 'a.txt'), 'a')
    const zip = join(tmp, 'evil.zip')
    const evil = { ...META, server: { ...META.server, jvmArgs: ['-javaagent:x.jar'] } }
    await zipFolder(src, zip, { meta: evil as BackupMeta })
    expect(await readMeta(zip)).toBeNull()
  })

  it('returns null for a zip without metadata', async () => {
    const zip = join(tmp, 'plain.zip')
    const file = new yazl.ZipFile()
    file.addBuffer(Buffer.from('a'), 'a.txt')
    file.end()
    await pipeline(file.outputStream, createWriteStream(zip))
    expect(await readMeta(zip)).toBeNull()
  })
})

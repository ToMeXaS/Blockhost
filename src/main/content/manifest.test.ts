import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { manifestEntry, tempDir } from '../test-utils'
import { emptyManifest, entryKey, manifestPath, readManifest, writeManifest } from './manifest'

describe('manifest', () => {
  it('lives under .blockhost', () => {
    expect(manifestPath('C:\s')).toBe(join('C:\s', '.blockhost', 'content.json'))
  })

  it('reads a missing manifest as empty v2', async () => {
    expect(await readManifest(await tempDir())).toEqual(emptyManifest())
    expect(emptyManifest()).toEqual({ version: 2, includeBeta: false, entries: [] })
  })

  it('round-trips v2', async () => {
    const dir = await tempDir()
    const m = {
      version: 2 as const,
      includeBeta: true,
      entries: [
        manifestEntry({ fileName: 'a.jar', projectId: 'A', source: 'hangar', disabled: true })
      ]
    }
    await writeManifest(dir, m)
    expect(await readManifest(dir)).toEqual(m)
  })

  it('migrates a v1 manifest', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, '.blockhost'))
    await writeFile(
      manifestPath(dir),
      JSON.stringify({
        version: 1,
        entries: [
          {
            fileName: 'api.jar',
            projectId: 'API',
            versionId: 'v',
            title: 'API',
            versionNumber: '1',
            sha1: 'h',
            dependencyOf: ['SOD']
          },
          {
            fileName: 'sod.jar',
            projectId: 'SOD',
            versionId: 'w',
            title: 'Sodium',
            versionNumber: '2',
            sha1: 'i',
            dependencyOf: []
          }
        ]
      })
    )
    const when = new Date('2026-01-02T03:04:05.000Z')
    await utimes(manifestPath(dir), when, when)
    const m = await readManifest(dir)
    expect(m.version).toBe(2)
    expect(m.includeBeta).toBe(false)
    expect(m.entries).toEqual([
      {
        fileName: 'api.jar',
        source: 'modrinth',
        projectId: 'API',
        versionId: 'v',
        title: 'API',
        versionNumber: '1',
        iconUrl: null,
        sha1: 'h',
        dependencyOf: ['modrinth:SOD'],
        disabled: false,
        explicit: false,
        installedAt: when.toISOString()
      },
      {
        fileName: 'sod.jar',
        source: 'modrinth',
        projectId: 'SOD',
        versionId: 'w',
        title: 'Sodium',
        versionNumber: '2',
        iconUrl: null,
        sha1: 'i',
        dependencyOf: [],
        disabled: false,
        explicit: true,
        installedAt: when.toISOString()
      }
    ])
  })

  it('treats a corrupt file as empty and drops malformed entries', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, '.blockhost'))
    await writeFile(manifestPath(dir), '{nope')
    expect(await readManifest(dir)).toEqual(emptyManifest())
    await writeFile(
      manifestPath(dir),
      JSON.stringify({
        version: 2,
        includeBeta: 'yes',
        entries: [{ fileName: 1 }, manifestEntry({ fileName: 'ok.jar', projectId: 'P' })]
      })
    )
    const m = await readManifest(dir)
    expect(m.includeBeta).toBe(false)
    expect(m.entries.map((e) => e.fileName)).toEqual(['ok.jar'])
  })

  it('rejects entries with an unknown source', async () => {
    const dir = await tempDir()
    await writeManifest(dir, { version: 2, includeBeta: false, entries: [] })
    const raw = JSON.parse(await readFile(manifestPath(dir), 'utf8'))
    raw.entries.push({ ...manifestEntry({ fileName: 'x.jar', projectId: 'X' }), source: 'curse' })
    await writeFile(manifestPath(dir), JSON.stringify(raw))
    expect((await readManifest(dir)).entries).toEqual([])
  })

  it('builds keys from source and project', () => {
    expect(entryKey({ source: 'spigot', projectId: '28140' })).toBe('spigot:28140')
  })

  it('rethrows read errors other than a missing file', async () => {
    const dir = await tempDir()
    await mkdir(manifestPath(dir), { recursive: true })
    await expect(readManifest(dir)).rejects.toMatchObject({ code: 'EISDIR' })
  })
})

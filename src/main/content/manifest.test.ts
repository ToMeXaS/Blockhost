import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../test-utils'
import { manifestPath, readManifest, writeManifest, type ManifestEntry } from './manifest'

const entry: ManifestEntry = {
  fileName: 'sodium-0.6.jar',
  projectId: 'AANobbMI',
  versionId: 'v1',
  title: 'Sodium',
  versionNumber: '0.6.0',
  sha1: 'abc',
  dependencyOf: []
}

describe('manifest', () => {
  it('lives under .blockhost', () => {
    expect(manifestPath('C:/srv')).toBe(join('C:/srv', '.blockhost', 'content.json'))
  })

  it('reads a missing manifest as empty', async () => {
    expect(await readManifest(await tempDir())).toEqual({ version: 1, entries: [] })
  })

  it('round-trips', async () => {
    const dir = await tempDir()
    await writeManifest(dir, { version: 1, entries: [entry] })
    expect(JSON.parse(await readFile(manifestPath(dir), 'utf8'))).toEqual({
      version: 1,
      entries: [entry]
    })
    expect(await readManifest(dir)).toEqual({ version: 1, entries: [entry] })
  })

  it('treats a corrupt file as empty and drops malformed entries', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, '.blockhost'))
    await writeFile(manifestPath(dir), '{not json')
    expect(await readManifest(dir)).toEqual({ version: 1, entries: [] })
    await writeFile(
      manifestPath(dir),
      JSON.stringify({
        version: 1,
        entries: [entry, { fileName: 'x.jar' }, 'junk', { ...entry, dependencyOf: 'no' }]
      })
    )
    expect(await readManifest(dir)).toEqual({ version: 1, entries: [entry] })
  })
})

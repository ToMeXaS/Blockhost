import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeProviderDeps, installOpts, tempDir } from '../test-utils'
import { NEO_RUN_BAT } from './runBat.fixtures'
import {
  createNeoForgeProvider,
  NEOFORGE_VERSIONS,
  neoForgeToMc,
  neoForgeVersions,
  pickNeoForge
} from './neoforge'

const all = ['20.4.253', '21.1.261', '21.1.262', '26.3.0.75-beta', '26.3.0.88', '26.4.0.1-beta']

describe('neoForgeToMc', () => {
  it.each([
    ['20.2.93', '1.20.2'],
    ['21.0.167', '1.21'],
    ['21.1.262', '1.21.1'],
    ['26.1.2.122', '26.1.2'],
    ['26.3.0.88', '26.3'],
    ['26.3.0.75-beta', '26.3'],
    ['0.25w14craftmine.5-beta', null]
  ])('%s -> %s', (neo, mc) => {
    expect(neoForgeToMc(neo)).toBe(mc)
  })
})

describe('neoforge provider', () => {
  it('groups NeoForge versions by Minecraft version, newest first', () => {
    expect(neoForgeVersions(all)).toEqual([
      { id: '26.4', stable: false },
      { id: '26.3', stable: true },
      { id: '1.21.1', stable: true },
      { id: '1.20.4', stable: true }
    ])
  })

  it('picks the newest non-beta build, falling back to the newest beta', () => {
    expect(pickNeoForge(all, '26.3')).toBe('26.3.0.88')
    expect(pickNeoForge(all, '1.21.1')).toBe('21.1.262')
    expect(pickNeoForge(all, '26.4')).toBe('26.4.0.1-beta')
    expect(pickNeoForge(all, '1.19')).toBeUndefined()
  })

  it('downloads and runs the matching installer', async () => {
    const { deps, dl } = fakeProviderDeps(
      { [NEOFORGE_VERSIONS]: { versions: all } },
      async (_j, _a, cwd) => {
        await writeFile(join(cwd, 'run.bat'), NEO_RUN_BAT)
        return 0
      }
    )
    await createNeoForgeProvider(deps).install(installOpts(await tempDir(), '1.21.1'))
    expect(dl.calls[0].url).toBe(
      'https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.262/neoforge-21.1.262-installer.jar'
    )
  })
})

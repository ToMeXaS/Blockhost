import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeProviderDeps, installOpts, tempDir } from '../test-utils'
import { createMojangJavaLookup, createVanillaProvider, MOJANG_MANIFEST } from './vanilla'

const routes = {
  [MOJANG_MANIFEST]: {
    versions: [
      { id: '26.4-snapshot-4', type: 'snapshot', url: 'https://meta.test/snap.json' },
      { id: '26.3', type: 'release', url: 'https://meta.test/26.3.json' },
      { id: 'b1.7.3', type: 'old_beta', url: 'https://meta.test/b173.json' }
    ]
  },
  'https://meta.test/26.3.json': {
    downloads: { server: { url: 'https://dl.test/server.jar', sha1: 'deadbeef' } },
    javaVersion: { majorVersion: 25 }
  },
  'https://meta.test/b173.json': { downloads: {} }
}

describe('vanilla provider', () => {
  it('lists releases and snapshots only', async () => {
    const { deps } = fakeProviderDeps(routes)
    expect(await createVanillaProvider(deps).listVersions()).toEqual([
      { id: '26.4-snapshot-4', stable: false },
      { id: '26.3', stable: true }
    ])
  })

  it('downloads server.jar with sha1 verification', async () => {
    const dir = await tempDir()
    const { deps, dl } = fakeProviderDeps(routes)
    const spec = await createVanillaProvider(deps).install(installOpts(dir, '26.3'))
    expect(spec).toEqual({ args: ['-jar', 'server.jar'] })
    expect(dl.calls[0]).toMatchObject({
      url: 'https://dl.test/server.jar',
      dest: join(dir, 'server.jar'),
      hash: { algo: 'sha1', value: 'deadbeef' }
    })
  })

  it('rejects versions without an official server download', async () => {
    const { deps } = fakeProviderDeps(routes)
    await expect(
      createVanillaProvider(deps).install(installOpts(await tempDir(), 'b1.7.3'))
    ).rejects.toMatchObject({ code: 'NO_SERVER_JAR' })
  })

  it('looks up the required Java version from Mojang metadata', async () => {
    const { http } = fakeProviderDeps(routes)
    const lookup = createMojangJavaLookup(http)
    expect(await lookup('26.3')).toBe(25)
    expect(await lookup('1.7.10_pre4')).toBeUndefined()
  })
})

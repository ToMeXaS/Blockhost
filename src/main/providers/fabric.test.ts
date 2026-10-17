import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeProviderDeps, installOpts, tempDir } from '../test-utils'
import { createFabricProvider, FABRIC_META } from './fabric'

const routes = {
  [`${FABRIC_META}/game`]: [
    { version: '26.4-snapshot-4', stable: false },
    { version: '26.3', stable: true }
  ],
  [`${FABRIC_META}/loader`]: [
    { version: '0.20.0', stable: false },
    { version: '0.19.2', stable: true }
  ],
  [`${FABRIC_META}/installer`]: [{ version: '1.1.2', stable: true }]
}

describe('fabric provider', () => {
  it('lists game versions with stability', async () => {
    const { deps } = fakeProviderDeps(routes)
    expect(await createFabricProvider(deps).listVersions()).toEqual([
      { id: '26.4-snapshot-4', stable: false },
      { id: '26.3', stable: true }
    ])
  })

  it('downloads the server launcher for the latest stable loader and installer', async () => {
    const dir = await tempDir()
    const { deps, dl } = fakeProviderDeps(routes)
    const spec = await createFabricProvider(deps).install(installOpts(dir, '26.3'))
    expect(spec).toEqual({ args: ['-jar', 'fabric-server-launch.jar'] })
    expect(dl.calls[0]).toMatchObject({
      url: `${FABRIC_META}/loader/26.3/0.19.2/1.1.2/server/jar`,
      dest: join(dir, 'fabric-server-launch.jar')
    })
  })
})

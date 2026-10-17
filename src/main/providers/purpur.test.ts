import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeProviderDeps, installOpts, tempDir } from '../test-utils'
import { createPurpurProvider, PURPUR_API } from './purpur'

const routes = {
  [PURPUR_API]: { versions: ['1.21.4', '26.3'] },
  [`${PURPUR_API}/26.3`]: { builds: { latest: '2601', all: ['2600', '2601'] } },
  [`${PURPUR_API}/26.3/2601`]: { md5: 'md5-2601' },
  [`${PURPUR_API}/26.3/2600`]: { md5: 'md5-2600' }
}

describe('purpur provider', () => {
  it('lists versions newest first', async () => {
    const { deps } = fakeProviderDeps(routes)
    expect(await createPurpurProvider(deps).listVersions()).toEqual([
      { id: '26.3', stable: true },
      { id: '1.21.4', stable: true }
    ])
  })

  it('lists builds newest first', async () => {
    const { deps } = fakeProviderDeps(routes)
    expect(await createPurpurProvider(deps).listBuilds!('26.3')).toEqual([
      { id: '2601', stable: true },
      { id: '2600', stable: true }
    ])
  })

  it('installs the latest build with md5 verification', async () => {
    const dir = await tempDir()
    const { deps, dl } = fakeProviderDeps(routes)
    const spec = await createPurpurProvider(deps).install(installOpts(dir, '26.3'))
    expect(spec).toEqual({ args: ['-jar', 'server.jar'] })
    expect(dl.calls[0]).toMatchObject({
      url: `${PURPUR_API}/26.3/2601/download`,
      dest: join(dir, 'server.jar'),
      hash: { algo: 'md5', value: 'md5-2601' }
    })
  })

  it('installs an explicitly chosen build', async () => {
    const { deps, dl } = fakeProviderDeps(routes)
    await createPurpurProvider(deps).install(installOpts(await tempDir(), '26.3', '2600'))
    expect(dl.calls[0]).toMatchObject({
      url: `${PURPUR_API}/26.3/2600/download`,
      hash: { value: 'md5-2600' }
    })
  })
})

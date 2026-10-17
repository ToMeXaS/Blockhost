import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeProviderDeps, installOpts, tempDir } from '../test-utils'
import { createPaperProvider, PAPER_API } from './paper'

function build(id: number, channel: string) {
  return {
    id,
    channel,
    downloads: {
      'server:default': {
        name: `paper-26.3-${id}.jar`,
        url: `https://dl.test/${id}.jar`,
        checksums: { sha256: `sha${id}` }
      }
    }
  }
}

const routes = {
  [`${PAPER_API}/versions`]: {
    versions: [{ version: { id: '26.3' } }, { version: { id: '26.3-rc-3' } }]
  },
  [`${PAPER_API}/versions/26.3/builds`]: [build(204, 'BETA'), build(203, 'STABLE')]
}

describe('paper provider', () => {
  it('lists versions, marking release candidates unstable', async () => {
    const { deps } = fakeProviderDeps(routes)
    expect(await createPaperProvider(deps).listVersions()).toEqual([
      { id: '26.3', stable: true },
      { id: '26.3-rc-3', stable: false }
    ])
  })

  it('lists builds newest first', async () => {
    const { deps } = fakeProviderDeps(routes)
    expect(await createPaperProvider(deps).listBuilds!('26.3')).toEqual([
      { id: '204', stable: false },
      { id: '203', stable: true }
    ])
  })

  it('installs the newest stable build by default', async () => {
    const dir = await tempDir()
    const { deps, dl } = fakeProviderDeps(routes)
    const spec = await createPaperProvider(deps).install(installOpts(dir, '26.3'))
    expect(spec).toEqual({ args: ['-jar', 'server.jar'] })
    expect(dl.calls[0]).toMatchObject({
      url: 'https://dl.test/203.jar',
      dest: join(dir, 'server.jar'),
      hash: { algo: 'sha256', value: 'sha203' }
    })
  })

  it('installs an explicitly chosen build', async () => {
    const { deps, dl } = fakeProviderDeps(routes)
    await createPaperProvider(deps).install(installOpts(await tempDir(), '26.3', '204'))
    expect(dl.calls[0].url).toBe('https://dl.test/204.jar')
  })

  it('rejects an unknown build', async () => {
    const { deps } = fakeProviderDeps(routes)
    await expect(
      createPaperProvider(deps).install(installOpts(await tempDir(), '26.3', '999'))
    ).rejects.toMatchObject({ code: 'BUILD_NOT_FOUND' })
  })
})

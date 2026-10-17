import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RunJava } from '../java/run'
import { fakeProviderDeps, installOpts, tempDir } from '../test-utils'
import { createForgeProvider, FORGE_PROMOS, forgeVersionsFromPromos } from './forge'
import { FORGE_RUN_BAT } from './runBat.fixtures'

const promos = {
  '1.7.10-latest': '10.13.4.1614',
  '1.12.2-latest': '14.23.5.2860',
  '1.12.2-recommended': '14.23.5.2859',
  '1.21.11-latest': '61.2.4',
  '1.21.11-recommended': '61.2.0',
  '26.3-latest': '66.0.13'
}
const routes = { [FORGE_PROMOS]: { promos } }
const writesRunBat: RunJava = async (_java, _args, cwd) => {
  await writeFile(join(cwd, 'run.bat'), FORGE_RUN_BAT)
  return 0
}

describe('forge provider', () => {
  it('lists Minecraft versions >= 1.12.2, newest first', () => {
    expect(forgeVersionsFromPromos(promos)).toEqual([
      { id: '26.3', stable: true },
      { id: '1.21.11', stable: true },
      { id: '1.12.2', stable: true }
    ])
  })

  it('installs the latest Forge when no recommended build exists', async () => {
    const { deps, dl } = fakeProviderDeps(routes, writesRunBat)
    const spec = await createForgeProvider(deps).install(installOpts(await tempDir(), '26.3'))
    expect(dl.calls[0].url).toBe(
      'https://maven.minecraftforge.net/net/minecraftforge/forge/26.3-66.0.13/forge-26.3-66.0.13-installer.jar'
    )
    expect(spec.args).toEqual(['@libraries/net/minecraftforge/forge/26.3-66.0.13/win_args.txt'])
  })

  it('prefers the recommended Forge build', async () => {
    const { deps, dl } = fakeProviderDeps(routes, writesRunBat)
    await createForgeProvider(deps).install(installOpts(await tempDir(), '1.21.11'))
    expect(dl.calls[0].url).toContain('/1.21.11-61.2.0/')
  })

  it('rejects unknown Minecraft versions', async () => {
    const { deps } = fakeProviderDeps(routes, writesRunBat)
    await expect(
      createForgeProvider(deps).install(installOpts(await tempDir(), '9.9'))
    ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' })
  })
})

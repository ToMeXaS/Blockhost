import type { VersionInfo } from '../../shared/types'
import { AppError } from '../errors'
import { compareMcVersions } from '../util/mcVersion'
import { runModLoaderInstaller } from './modloader'
import type { ProviderDeps, ServerProvider } from './types'

export const FORGE_PROMOS =
  'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'
// Older Forge releases use irregular version naming that the maven URL scheme below can't express.
const MIN_FORGE_MC = '1.12.2'

export function forgeVersionsFromPromos(promos: Record<string, string>): VersionInfo[] {
  const versions = new Set<string>()
  for (const key of Object.keys(promos)) {
    const match = /^(.+)-(latest|recommended)$/.exec(key)
    if (match && compareMcVersions(match[1], MIN_FORGE_MC) >= 0) versions.add(match[1])
  }
  return [...versions]
    .sort((a, b) => compareMcVersions(b, a))
    .map((id) => ({ id, stable: !/pre|rc|snapshot/i.test(id) }))
}

export function createForgeProvider(deps: ProviderDeps): ServerProvider {
  const promos = async (): Promise<Record<string, string>> =>
    (await deps.http.getJson<{ promos: Record<string, string> }>(FORGE_PROMOS)).promos

  return {
    type: 'forge',
    label: 'Forge',

    async listVersions() {
      return forgeVersionsFromPromos(await promos())
    },

    async install(opts) {
      const all = await promos()
      const forge = all[`${opts.version}-recommended`] ?? all[`${opts.version}-latest`]
      if (!forge) {
        throw new AppError(
          'VERSION_NOT_FOUND',
          `Forge is not available for Minecraft ${opts.version}`
        )
      }
      const full = `${opts.version}-${forge}`
      opts.onLog(`Installing Forge ${forge} for Minecraft ${opts.version}`)
      return runModLoaderInstaller(deps, opts, `${FORGE_MAVEN}/${full}/forge-${full}-installer.jar`)
    }
  }
}

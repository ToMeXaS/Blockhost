import type { VersionInfo } from '../../shared/types'
import { AppError } from '../errors'
import { compareMcVersions } from '../util/mcVersion'
import { runModLoaderInstaller } from './modloader'
import type { ProviderDeps, ServerProvider } from './types'

export const NEOFORGE_VERSIONS =
  'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge'

/** "21.1.262" -> "1.21.1", "21.0.167" -> "1.21", "26.1.2.122" -> "26.1.2", "26.3.0.88" -> "26.3". */
export function neoForgeToMc(neo: string): string | null {
  const parts = neo.split('-')[0].split('.').map(Number)
  if (parts.length < 3 || parts.some(Number.isNaN) || parts[0] < 20) return null
  const [major, minor, patch] = parts
  if (major >= 26)
    return parts.length >= 4 && patch !== 0 ? `${major}.${minor}.${patch}` : `${major}.${minor}`
  return minor === 0 ? `1.${major}` : `1.${major}.${minor}`
}

const isBeta = (neo: string): boolean => neo.includes('-')
const byNeoVersion = (a: string, b: string): number =>
  compareMcVersions(a.split('-')[0], b.split('-')[0])

export function pickNeoForge(all: string[], mc: string): string | undefined {
  const matches = all.filter((v) => neoForgeToMc(v) === mc).sort(byNeoVersion)
  return [...matches].reverse().find((v) => !isBeta(v)) ?? matches.at(-1)
}

export function neoForgeVersions(all: string[]): VersionInfo[] {
  const stableByMc = new Map<string, boolean>()
  for (const neo of all) {
    const mc = neoForgeToMc(neo)
    if (mc) stableByMc.set(mc, (stableByMc.get(mc) ?? false) || !isBeta(neo))
  }
  return [...stableByMc]
    .sort(([a], [b]) => compareMcVersions(b, a))
    .map(([id, stable]) => ({ id, stable }))
}

export function createNeoForgeProvider(deps: ProviderDeps): ServerProvider {
  const all = async (): Promise<string[]> =>
    (await deps.http.getJson<{ versions: string[] }>(NEOFORGE_VERSIONS)).versions

  return {
    type: 'neoforge',
    label: 'NeoForge',

    async listVersions() {
      return neoForgeVersions(await all())
    },

    async install(opts) {
      const neo = pickNeoForge(await all(), opts.version)
      if (!neo) {
        throw new AppError(
          'VERSION_NOT_FOUND',
          `NeoForge is not available for Minecraft ${opts.version}`
        )
      }
      opts.onLog(`Installing NeoForge ${neo} for Minecraft ${opts.version}`)
      return runModLoaderInstaller(
        deps,
        opts,
        `${NEOFORGE_MAVEN}/${neo}/neoforge-${neo}-installer.jar`
      )
    }
  }
}

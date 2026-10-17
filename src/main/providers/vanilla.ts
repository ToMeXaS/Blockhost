import { join } from 'node:path'
import { AppError } from '../errors'
import type { HttpClient } from '../net/http'
import { percentReporter, type ProviderDeps, type ServerProvider } from './types'

export const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

interface Manifest {
  versions: { id: string; type: string; url: string }[]
}

interface VersionMeta {
  downloads: { server?: { url: string; sha1: string } }
  javaVersion?: { majorVersion: number }
}

async function versionMeta(http: HttpClient, version: string): Promise<VersionMeta | undefined> {
  const manifest = await http.getJson<Manifest>(MOJANG_MANIFEST)
  const entry = manifest.versions.find((v) => v.id === version)
  return entry ? http.getJson<VersionMeta>(entry.url) : undefined
}

/** Required Java major for a Minecraft version according to Mojang, if known. */
export function createMojangJavaLookup(http: HttpClient) {
  return async (mcVersion: string): Promise<number | undefined> =>
    (await versionMeta(http, mcVersion))?.javaVersion?.majorVersion
}

export function createVanillaProvider({ http, download }: ProviderDeps): ServerProvider {
  return {
    type: 'vanilla',
    label: 'Vanilla',

    async listVersions() {
      const manifest = await http.getJson<Manifest>(MOJANG_MANIFEST)
      return manifest.versions
        .filter((v) => v.type === 'release' || v.type === 'snapshot')
        .map((v) => ({ id: v.id, stable: v.type === 'release' }))
    },

    async install(opts) {
      const server = (await versionMeta(http, opts.version))?.downloads.server
      if (!server) {
        throw new AppError(
          'NO_SERVER_JAR',
          `Minecraft ${opts.version} has no official server download`
        )
      }
      opts.onLog(`Downloading Minecraft server ${opts.version}`)
      await download({
        url: server.url,
        dest: join(opts.dir, 'server.jar'),
        hash: { algo: 'sha1', value: server.sha1 },
        onProgress: percentReporter(opts.onProgress)
      })
      return { args: ['-jar', 'server.jar'] }
    }
  }
}

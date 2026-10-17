import { join } from 'node:path'
import { percentReporter, type ProviderDeps, type ServerProvider } from './types'

export const PURPUR_API = 'https://api.purpurmc.org/v2/purpur'

interface PurpurVersion {
  builds: { latest: string; all: string[] }
}

export function createPurpurProvider({ http, download }: ProviderDeps): ServerProvider {
  const versionInfo = (version: string): Promise<PurpurVersion> =>
    http.getJson<PurpurVersion>(`${PURPUR_API}/${encodeURIComponent(version)}`)

  return {
    type: 'purpur',
    label: 'Purpur',

    async listVersions() {
      const data = await http.getJson<{ versions: string[] }>(PURPUR_API)
      return [...data.versions].reverse().map((id) => ({ id, stable: true }))
    },

    async listBuilds(version) {
      const info = await versionInfo(version)
      return [...info.builds.all].reverse().map((id) => ({ id, stable: true }))
    },

    async install(opts) {
      const build = opts.build ?? (await versionInfo(opts.version)).builds.latest
      const base = `${PURPUR_API}/${encodeURIComponent(opts.version)}/${encodeURIComponent(build)}`
      const { md5 } = await http.getJson<{ md5: string }>(base)
      opts.onLog(`Downloading Purpur ${opts.version} build ${build}`)
      await download({
        url: `${base}/download`,
        dest: join(opts.dir, 'server.jar'),
        hash: { algo: 'md5', value: md5 },
        onProgress: percentReporter(opts.onProgress)
      })
      return { args: ['-jar', 'server.jar'] }
    }
  }
}

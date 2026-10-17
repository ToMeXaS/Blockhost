import { join } from 'node:path'
import { AppError } from '../errors'
import { percentReporter, type ProviderDeps, type ServerProvider } from './types'

export const PAPER_API = 'https://fill.papermc.io/v3/projects/paper'

interface PaperVersions {
  versions: { version: { id: string } }[]
}

interface PaperBuild {
  id: number
  channel: string
  downloads: Record<string, { name: string; url: string; checksums: { sha256: string } }>
}

export function createPaperProvider({ http, download }: ProviderDeps): ServerProvider {
  const builds = (version: string): Promise<PaperBuild[]> =>
    http.getJson<PaperBuild[]>(`${PAPER_API}/versions/${encodeURIComponent(version)}/builds`)

  return {
    type: 'paper',
    label: 'Paper',

    async listVersions() {
      const data = await http.getJson<PaperVersions>(`${PAPER_API}/versions`)
      return data.versions.map((v) => ({ id: v.version.id, stable: !v.version.id.includes('-') }))
    },

    async listBuilds(version) {
      return (await builds(version)).map((b) => ({
        id: String(b.id),
        stable: b.channel === 'STABLE'
      }))
    },

    async install(opts) {
      const list = await builds(opts.version)
      const chosen = opts.build
        ? list.find((b) => String(b.id) === opts.build)
        : (list.find((b) => b.channel === 'STABLE') ?? list[0])
      const file = chosen?.downloads['server:default']
      if (!chosen || !file) {
        throw new AppError(
          'BUILD_NOT_FOUND',
          `Paper build ${opts.build ?? 'latest'} for ${opts.version} was not found`
        )
      }
      opts.onLog(`Downloading ${file.name}`)
      await download({
        url: file.url,
        dest: join(opts.dir, 'server.jar'),
        hash: { algo: 'sha256', value: file.checksums.sha256 },
        onProgress: percentReporter(opts.onProgress)
      })
      return { args: ['-jar', 'server.jar'] }
    }
  }
}

import { join } from 'node:path'
import { AppError } from '../errors'
import { percentReporter, type ProviderDeps, type ServerProvider } from './types'

export const FABRIC_META = 'https://meta.fabricmc.net/v2/versions'

interface FabricEntry {
  version: string
  stable: boolean
}

const pickStable = (list: FabricEntry[]): FabricEntry | undefined =>
  list.find((e) => e.stable) ?? list[0]

export function createFabricProvider({ http, download }: ProviderDeps): ServerProvider {
  return {
    type: 'fabric',
    label: 'Fabric',

    async listVersions() {
      const games = await http.getJson<FabricEntry[]>(`${FABRIC_META}/game`)
      return games.map((g) => ({ id: g.version, stable: g.stable }))
    },

    async install(opts) {
      const loader = pickStable(await http.getJson<FabricEntry[]>(`${FABRIC_META}/loader`))
      const installer = pickStable(await http.getJson<FabricEntry[]>(`${FABRIC_META}/installer`))
      if (!loader || !installer) {
        throw new AppError('VERSION_NOT_FOUND', 'Fabric loader metadata is unavailable')
      }
      const url = `${FABRIC_META}/loader/${encodeURIComponent(opts.version)}/${loader.version}/${installer.version}/server/jar`
      opts.onLog(`Downloading Fabric ${loader.version} for Minecraft ${opts.version}`)
      await download({
        url,
        dest: join(opts.dir, 'fabric-server-launch.jar'),
        onProgress: percentReporter(opts.onProgress)
      })
      return { args: ['-jar', 'fabric-server-launch.jar'] }
    }
  }
}

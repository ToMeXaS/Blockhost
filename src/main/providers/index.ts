import type { ServerType } from '../../shared/types'
import { createFabricProvider } from './fabric'
import { createForgeProvider } from './forge'
import { createNeoForgeProvider } from './neoforge'
import { createPaperProvider } from './paper'
import { createPurpurProvider } from './purpur'
import type { ProviderDeps, ServerProvider } from './types'
import { createVanillaProvider } from './vanilla'

export function createProviders(deps: ProviderDeps): Record<ServerType, ServerProvider> {
  return {
    vanilla: createVanillaProvider(deps),
    paper: createPaperProvider(deps),
    purpur: createPurpurProvider(deps),
    fabric: createFabricProvider(deps),
    forge: createForgeProvider(deps),
    neoforge: createNeoForgeProvider(deps)
  }
}

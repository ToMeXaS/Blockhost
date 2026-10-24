import { createModrinthClient } from '../modrinth'
import type { ContentProvider } from '../types'
import { hangarProvider } from './hangar'
import { modrinthProvider } from './modrinth'
import { spigetProvider } from './spiget'

export interface ProviderOptions {
  userAgent: string
  fetchImpl?: typeof fetch
}

/** Every content source, in the order search results are interleaved. */
export function createContentProviders(opts: ProviderOptions): ContentProvider[] {
  return [modrinthProvider(createModrinthClient(opts)), hangarProvider(opts), spigetProvider(opts)]
}

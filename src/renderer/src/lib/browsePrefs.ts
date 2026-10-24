import {
  CONTENT_CATEGORIES,
  CONTENT_SORTS,
  CONTENT_SOURCES,
  type ContentCategory,
  type ContentSort,
  type ContentSource
} from '../../../shared/types'

export interface BrowsePrefs {
  /** null = every source available for the server */
  sources: ContentSource[] | null
  category: ContentCategory | null
  sort: ContentSort
}

const key = (serverId: string): string => `blockhost.content.browse.${serverId}`
const DEFAULTS: BrowsePrefs = { sources: null, category: null, sort: 'relevance' }

export function loadPrefs(
  serverId: string,
  storage: Pick<Storage, 'getItem'> = localStorage
): BrowsePrefs {
  try {
    const raw = JSON.parse(storage.getItem(key(serverId)) ?? 'null') as Partial<
      Record<keyof BrowsePrefs, unknown>
    > | null
    if (!raw) return { ...DEFAULTS }
    return {
      sources: Array.isArray(raw.sources)
        ? raw.sources.filter((s): s is ContentSource =>
            (CONTENT_SOURCES as readonly unknown[]).includes(s)
          )
        : null,
      category: (CONTENT_CATEGORIES as readonly unknown[]).includes(raw.category)
        ? (raw.category as ContentCategory)
        : null,
      sort: (CONTENT_SORTS as readonly unknown[]).includes(raw.sort)
        ? (raw.sort as ContentSort)
        : 'relevance'
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function savePrefs(
  serverId: string,
  prefs: BrowsePrefs,
  storage: Pick<Storage, 'setItem'> = localStorage
): void {
  try {
    storage.setItem(key(serverId), JSON.stringify(prefs))
  } catch {
    // Storage blocked or full: preferences are a convenience only.
  }
}

import type { ContentSearchHit } from '../../../shared/types'

export interface HitGroup {
  /** `source:projectId` of the primary hit; unique across groups. */
  key: string
  /** The first-ranked listing: what the row opens and installs. */
  primary: ContentSearchHit
  /** Every listing of the project, primary first, at most one per source. */
  hits: ContentSearchHit[]
  downloads: number
  installed: boolean
}

/**
 * Normalises a title so one project's listings on different sites compare equal:
 * drops bracketed notes ("[1.8-1.21]"), "| tagline" suffixes, case and punctuation.
 */
export function titleKey(title: string): string {
  return title
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .split(' | ')[0]
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** An author name compared loosely; empty when the source doesn't say (Spiget never does). */
const authorKey = (author: string | null): string =>
  (author ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Folds the same project listed by several sources into one entry, keeping rank order.
 * Listings join when their titles match and their authors don't contradict each other.
 */
export function groupHits(hits: ContentSearchHit[]): HitGroup[] {
  const groups: HitGroup[] = []
  const byTitle = new Map<string, HitGroup[]>()
  for (const hit of hits) {
    const title = titleKey(hit.title)
    const author = authorKey(hit.author)
    const candidates = title ? (byTitle.get(title) ?? []) : []
    const group = candidates.find(
      (g) =>
        !g.hits.some((h) => h.source === hit.source) &&
        g.hits.every((h) => !author || !authorKey(h.author) || authorKey(h.author) === author)
    )
    if (group) {
      group.hits.push(hit)
      group.downloads += hit.downloads
      group.installed ||= hit.installed
      continue
    }
    const fresh: HitGroup = {
      key: `${hit.source}:${hit.projectId}`,
      primary: hit,
      hits: [hit],
      downloads: hit.downloads,
      installed: hit.installed
    }
    groups.push(fresh)
    if (title) byTitle.set(title, [...candidates, fresh])
  }
  return groups
}

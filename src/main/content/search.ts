import type { ContentCursor, ContentSourceStatus } from '../../shared/types'
import type { AppError } from '../errors'
import { isSourceDown } from './http'
import type { ContentProvider, Hit, ProviderQuery } from './types'

export const PAGE_SIZE = 20

export async function searchAll(
  providers: ContentProvider[],
  query: Omit<ProviderQuery, 'offset' | 'limit'>,
  cursor: ContentCursor | null,
  limit = PAGE_SIZE
): Promise<{ hits: Hit[]; sources: ContentSourceStatus[]; cursor: ContentCursor | null }> {
  const next: ContentCursor = {}
  const sources: ContentSourceStatus[] = []
  const pages: Hit[][] = []
  let attempted = 0
  let failed: unknown = null

  await Promise.all(
    providers.map(async (p, i) => {
      const at = cursor ? cursor[p.id] : 0
      const q: ProviderQuery = { ...query, offset: typeof at === 'number' ? at : 0, limit }
      const skipped =
        (query.category !== null && !p.categories[query.category]?.length) ||
        (p.supportsQuery !== undefined && !p.supportsQuery(q))
      if (skipped) {
        sources[i] = { source: p.id, status: 'skipped', total: 0 }
        next[p.id] = 'done'
        pages[i] = []
        return
      }
      if (at === 'done' || at === undefined) {
        sources[i] = { source: p.id, status: 'ok', total: 0 }
        next[p.id] = 'done'
        pages[i] = []
        return
      }
      attempted++
      try {
        const r = await p.search(q)
        pages[i] = r.hits
        sources[i] = { source: p.id, status: 'ok', total: r.total }
        // A provider that filters client-side reports the raw page size it fetched.
        const got = r.fetched ?? r.hits.length
        const offset = q.offset + got
        next[p.id] = got < limit || offset >= r.total ? 'done' : offset
      } catch (err) {
        if (!isSourceDown(err)) throw err
        failed = err
        pages[i] = []
        sources[i] = { source: p.id, status: 'error', total: 0, message: (err as AppError).message }
        next[p.id] = q.offset
      }
    })
  )

  // Only a search where every source we actually asked failed is an error for the caller.
  const errors = sources.filter((s) => s.status === 'error').length
  if (attempted > 0 && errors === attempted) throw failed

  const hits: Hit[] = []
  const longest = Math.max(0, ...pages.map((p) => p.length))
  for (let rank = 0; rank < longest; rank++) {
    for (const page of pages) if (page[rank]) hits.push(page[rank])
  }
  const more = Object.values(next).some((v) => typeof v === 'number')
  return { hits, sources, cursor: more ? next : null }
}

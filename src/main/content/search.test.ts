import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../errors'
import { contentTarget } from './loaders'
import { searchAll } from './search'
import type { ContentProvider, Hit } from './types'

const hit = (source: Hit['source'], n: number): Hit => ({
  source,
  projectId: `${source}${n}`,
  slug: `${source}${n}`,
  title: `${source} ${n}`,
  author: null,
  description: '',
  iconUrl: null,
  downloads: 0,
  updatedAt: null,
  untestedOnVersion: false
})

function provider(
  id: Hit['source'],
  pages: Hit[][],
  total: number,
  extra: Partial<ContentProvider> = {}
): ContentProvider & { search: ReturnType<typeof vi.fn> } {
  return {
    id,
    label: id,
    supports: () => true,
    downloadHosts: [],
    categories: { chat: ['c'] },
    search: vi.fn(async (q) => ({ hits: pages[q.offset / 2] ?? [], total })),
    project: vi.fn(),
    versions: vi.fn(),
    allVersions: vi.fn(),
    ...extra
  } as never
}

const base = {
  target: contentTarget('paper')!,
  mcVersion: '1.21.4',
  text: 'x',
  category: null,
  sort: 'relevance' as const
}

describe('searchAll', () => {
  it('interleaves by rank and tracks a cursor per source', async () => {
    const a = provider(
      'modrinth',
      [[hit('modrinth', 1), hit('modrinth', 2)], [hit('modrinth', 3)]],
      3
    )
    const b = provider('hangar', [[hit('hangar', 1)]], 1)
    const r = await searchAll([a, b], base, null, 2)
    expect(r.hits.map((h) => h.projectId)).toEqual(['modrinth1', 'hangar1', 'modrinth2'])
    expect(r.cursor).toEqual({ modrinth: 2, hangar: 'done' })
    expect(r.sources).toEqual([
      { source: 'modrinth', status: 'ok', total: 3 },
      { source: 'hangar', status: 'ok', total: 1 }
    ])
    const next = await searchAll([a, b], base, r.cursor, 2)
    expect(next.hits.map((h) => h.projectId)).toEqual(['modrinth3'])
    expect(b.search).toHaveBeenCalledTimes(1)
    expect(next.cursor).toBeNull()
  })

  it('keeps going when one source fails and retries the same page later', async () => {
    const a = provider('modrinth', [[hit('modrinth', 1)]], 1)
    const b = provider('hangar', [], 0, {
      search: vi.fn(async () => {
        throw new AppError('NETWORK', 'Could not reach Hangar')
      })
    })
    const r = await searchAll([a, b], base, null, 2)
    expect(r.hits).toHaveLength(1)
    expect(r.sources[1]).toEqual({
      source: 'hangar',
      status: 'error',
      total: 0,
      message: 'Could not reach Hangar'
    })
    expect(r.cursor).toEqual({ modrinth: 'done', hangar: 0 })
  })

  it('rejects when every source fails', async () => {
    const b = provider('hangar', [], 0, {
      search: vi.fn(async () => {
        throw new AppError('NETWORK', 'down')
      })
    })
    await expect(searchAll([b], base, null, 2)).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('skips sources without the category or that cannot serve the query', async () => {
    const a = provider('modrinth', [[hit('modrinth', 1)]], 1, { categories: {} })
    const b = provider('spigot', [[hit('spigot', 1)]], 1, { supportsQuery: () => false })
    const c = provider('hangar', [[hit('hangar', 1)]], 1)
    const r = await searchAll([a, b, c], { ...base, category: 'chat' }, null, 2)
    expect(r.sources.map((s) => s.status)).toEqual(['skipped', 'skipped', 'ok'])
    expect(a.search).not.toHaveBeenCalled()
    expect(r.hits.map((h) => h.source)).toEqual(['hangar'])
  })

  it('rethrows programming errors', async () => {
    const a = provider('modrinth', [], 0, {
      search: vi.fn(async () => {
        throw new TypeError('bug')
      })
    })
    await expect(searchAll([a], base, null, 2)).rejects.toThrow('bug')
  })
})

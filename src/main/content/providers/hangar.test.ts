import { describe, expect, it, vi } from 'vitest'
import { contentTarget } from '../loaders'
import { PROJECT, SEARCH, VERSIONS } from './fixtures/hangar'
import { hangarProvider } from './hangar'

function fake(...bodies: unknown[]) {
  const urls: string[] = []
  const fetchImpl = (async (url: string) => {
    urls.push(url)
    return new Response(JSON.stringify(bodies.shift()))
  }) as unknown as typeof fetch
  return {
    urls,
    p: hangarProvider({
      userAgent: 'x',
      fetchImpl,
      base: 'https://h.test/api/v1',
      sleep: vi.fn(async () => {})
    })
  }
}

const paper = contentTarget('paper')!
const q = {
  target: paper,
  mcVersion: '1.21.4',
  text: '',
  category: null,
  sort: 'downloads' as const,
  offset: 40,
  limit: 20
}

describe('hangarProvider', () => {
  it('supports plugin servers only', () => {
    const { p } = fake()
    expect(p.supports(paper)).toBe(true)
    expect(p.supports(contentTarget('purpur')!)).toBe(true)
    expect(p.supports(contentTarget('fabric')!)).toBe(false)
    expect(p.downloadHosts).toEqual(['hangarcdn.papermc.io'])
  })

  it('builds the search URL and maps hits', async () => {
    const { p, urls } = fake(SEARCH)
    const r = await p.search({ ...q, category: 'admin' })
    const u = new URL(urls[0])
    expect(u.pathname).toBe('/api/v1/projects')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      limit: '20',
      offset: '40',
      platform: 'PAPER',
      version: '1.21.4',
      sort: '-downloads',
      category: 'admin_tools'
    })
    expect(r.total).toBe(SEARCH.pagination.count)
    expect(r.hits[0]).toEqual({
      source: 'hangar',
      projectId: SEARCH.result[0].namespace.slug,
      slug: SEARCH.result[0].namespace.slug,
      title: SEARCH.result[0].name,
      author: SEARCH.result[0].namespace.owner,
      description: SEARCH.result[0].description,
      iconUrl: SEARCH.result[0].avatarUrl,
      downloads: SEARCH.result[0].stats.downloads,
      updatedAt: SEARCH.result[0].lastUpdated,
      untestedOnVersion: false
    })
  })

  it('omits sort for a relevance search with text and maps the other sorts', async () => {
    const { p, urls } = fake(SEARCH, SEARCH, SEARCH)
    await p.search({ ...q, text: 'via', sort: 'relevance' })
    expect(new URL(urls[0]).searchParams.get('sort')).toBeNull()
    expect(new URL(urls[0]).searchParams.get('q')).toBe('via')
    await p.search({ ...q, sort: 'updated' })
    expect(new URL(urls[1]).searchParams.get('sort')).toBe('-updated')
    await p.search({ ...q, sort: 'newest' })
    expect(new URL(urls[2]).searchParams.get('sort')).toBe('-newest')
  })

  it('maps project details from markdown and settings links', async () => {
    const { p } = fake(PROJECT)
    const info = await p.project('ViaBackwards')
    expect(info).toMatchObject({
      id: PROJECT.namespace.slug,
      title: PROJECT.name,
      author: PROJECT.namespace.owner,
      description: { format: 'markdown' },
      gallery: [],
      pageUrl: `https://hangar.papermc.io/${PROJECT.namespace.owner}/${PROJECT.namespace.slug}`
    })
    expect(info.links[0]).toEqual({ kind: 'page', url: info.pageUrl })
  })

  it('maps versions: compatibility, channels, hashes, dependencies, external downloads', async () => {
    const { p, urls } = fake(VERSIONS, VERSIONS)
    const compatible = await p.versions('ViaBackwards', paper, '1.21.4')
    expect(new URL(urls[0]).pathname).toBe('/api/v1/projects/ViaBackwards/versions')
    expect(new URL(urls[0]).searchParams.get('platform')).toBe('PAPER')
    expect(compatible.every((v) => v.mcVersions.includes('1.21.4'))).toBe(true)
    const all = await p.allVersions('ViaBackwards')
    expect(all.length).toBeGreaterThan(compatible.length)
    const first = all[0]
    expect(first.file.hash?.algo).toBe('sha256')
    expect(first.loaders).toEqual(['paper'])
    expect(all.some((v) => v.channel === 'beta')).toBe(true)
    expect(all.some((v) => v.file.url === null && v.file.externalUrl)).toBe(true)
    const deps = all.flatMap((v) => v.dependencies)
    expect(deps).toContainEqual({
      projectId: null,
      versionId: null,
      kind: 'required',
      name: expect.any(String),
      externalUrl: 'https://luckperms.net/download'
    })
    expect(deps.some((d) => d.kind === 'optional' && d.projectId)).toBe(true)
  })
})

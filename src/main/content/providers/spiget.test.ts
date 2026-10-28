import { describe, expect, it, vi } from 'vitest'
import { contentTarget } from '../loaders'
import { BROWSE, LATEST, RESOURCE } from './fixtures/spiget'
import { isTestedOn, jarName, spigetProvider } from './spiget'

function fake(...responses: { body: unknown; headers?: Record<string, string> }[]) {
  const urls: string[] = []
  const fetchImpl = (async (url: string) => {
    urls.push(url)
    const r = responses.shift()!
    return new Response(JSON.stringify(r.body), { headers: r.headers })
  }) as unknown as typeof fetch
  return {
    urls,
    p: spigetProvider({
      userAgent: 'x',
      fetchImpl,
      base: 'https://s.test/v2',
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
  offset: 20,
  limit: 20
}

describe('isTestedOn', () => {
  it('matches exact or major.minor', () => {
    expect(isTestedOn(['1.21'], '1.21.4')).toBe(true)
    expect(isTestedOn(['1.21.4'], '1.21.4')).toBe(true)
    expect(isTestedOn(['1.20'], '1.21.4')).toBe(false)
    expect(isTestedOn(['26.1'], '26.1.2')).toBe(true)
  })
})

describe('jarName', () => {
  it('makes a safe .jar name', () => {
    expect(jarName('Luck Perms!', '5.5.71')).toBe('Luck-Perms-5.5.71.jar')
    expect(jarName('???', '')).toBe('plugin.jar')
    expect(jarName('Plug', '1..2...3')).toBe('Plug-1.2.3.jar')
  })
})

describe('spigetProvider', () => {
  it('supports plugin servers only', () => {
    const { p } = fake()
    expect(p.supports(paper)).toBe(true)
    expect(p.supports(contentTarget('forge')!)).toBe(false)
    expect(p.downloadHosts).toEqual(['api.spiget.org', 'cdn.spiget.org'])
  })

  it('browses with 1-based pages, filters out proxy resources, and estimates the total', async () => {
    const { p, urls } = fake({ body: BROWSE, headers: { 'X-Page-Count': '10' } })
    const r = await p.search(q)
    const u = new URL(urls[0])
    expect(u.pathname).toBe('/v2/resources')
    expect(u.searchParams.get('page')).toBe('2')
    expect(u.searchParams.get('size')).toBe('20')
    expect(u.searchParams.get('sort')).toBe('-downloads')
    expect(r.total).toBe(200)
    expect(r.hits.every((h) => h.source === 'spigot')).toBe(true)
    expect(r.hits.length).toBe(BROWSE.filter((b) => b.category.id !== 2).length)
    expect(r.hits.length).toBeLessThan(BROWSE.length)
    const prem = BROWSE.find((b) => b.premium)!
    expect(r.hits.map((h) => h.projectId)).toContain(String(prem.id))
    expect(r.fetched).toBe(BROWSE.length)
  })

  it('uses the search endpoint for text and the category endpoint for categories', async () => {
    const { p, urls } = fake({ body: BROWSE }, { body: BROWSE })
    await p.search({ ...q, text: 'luck perms', sort: 'relevance' })
    expect(new URL(urls[0]).pathname).toBe('/v2/search/resources/luck%20perms')
    expect(new URL(urls[0]).searchParams.get('sort')).toBeNull()
    await p.search({ ...q, category: 'chat' })
    expect(new URL(urls[1]).pathname).toBe('/v2/categories/14/resources')
  })

  it('cannot combine text with a category', () => {
    const { p } = fake()
    expect(p.supportsQuery!({ ...q, text: 'x', category: 'chat' })).toBe(false)
    expect(p.supportsQuery!({ ...q, text: 'x' })).toBe(true)
  })

  it('flags untested versions and builds icon URLs', async () => {
    const { p } = fake({ body: BROWSE })
    const r = await p.search({ ...q, mcVersion: '1.8.8' })
    const h = r.hits.find((x) => x.projectId === String(BROWSE[0].id))!
    expect(h.untestedOnVersion).toBe(!isTestedOn(BROWSE[0].testedVersions, '1.8.8'))
    if (BROWSE[0].icon.url) expect(h.iconUrl).toBe(`https://www.spigotmc.org/${BROWSE[0].icon.url}`)
  })

  it('maps a resource and its single downloadable version', async () => {
    const { p } = fake({ body: RESOURCE }, { body: RESOURCE }, { body: LATEST })
    const info = await p.project('28140')
    expect(info).toMatchObject({
      id: '28140',
      title: RESOURCE.name,
      description: { format: 'html', body: '<p>Hi</p>' },
      pageUrl: 'https://www.spigotmc.org/resources/28140'
    })
    const [v] = await p.versions('28140', paper, '1.21.4')
    expect(v).toMatchObject({
      id: String(LATEST.id),
      versionNumber: LATEST.name,
      channel: 'release',
      file: { url: 'https://api.spiget.org/v2/resources/28140/download', hash: null, sha1: null }
    })
    expect(v.file.filename).toMatch(/\.jar$/)
  })

  it('sends premium and external resources to the browser', async () => {
    const ext = BROWSE.find((b) => b.external)!
    const { p, urls } = fake({ body: ext }, { body: LATEST })
    const [v] = await p.versions(String(ext.id), paper, '1.21.4')
    expect(urls[0]).not.toMatch(/description|links/)
    expect(v.file.url).toBeNull()
    expect(v.file.externalUrl).toBe(`https://www.spigotmc.org/resources/${ext.id}`)
  })

  it('sends non-jar resources to the browser', async () => {
    const zip = BROWSE.find((b) => b.file.type === '.zip')!
    const { p } = fake({ body: zip }, { body: LATEST })
    const [v] = await p.versions(String(zip.id), paper, '1.21.4')
    expect(v.file.url).toBeNull()
    expect(v.file.externalUrl).toBe(`https://www.spigotmc.org/resources/${zip.id}`)
  })

  it('sends premium resources to the browser too', async () => {
    const prem = BROWSE.find((b) => b.premium)!
    const { p } = fake({ body: prem }, { body: LATEST })
    const [v] = await p.versions(String(prem.id), paper, '1.21.4')
    expect(v.file.url).toBeNull()
  })
})

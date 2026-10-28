import { describe, expect, it, vi } from 'vitest'
import { contentTarget } from './loaders'
import { createModrinthClient, searchFacets } from './modrinth'

interface Seen {
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
}

function fake(
  ...responses: { status?: number; body: unknown; headers?: Record<string, string> }[]
) {
  const seen: Seen[] = []
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    seen.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined
    })
    const r = responses.shift()!
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers })
  }) as unknown as typeof fetch
  const sleep = vi.fn(async () => {})
  const client = createModrinthClient({
    userAgent: 'Blockhost/test (x)',
    fetchImpl,
    base: 'https://mr.test/v2',
    sleep
  })
  return { seen, client, sleep }
}

const params = (url: string) => new URL(url).searchParams

describe('searchFacets', () => {
  it('filters by type, loaders, version and server support', () => {
    expect(searchFacets(contentTarget('paper')!, '1.21.4')).toEqual([
      ['project_type:plugin'],
      ['categories:paper', 'categories:spigot', 'categories:bukkit'],
      ['versions:1.21.4'],
      ['server_side:required', 'server_side:optional']
    ])
  })
})

describe('createModrinthClient', () => {
  it('searches by relevance with a query and by downloads without one', async () => {
    const { seen, client } = fake(
      {
        body: {
          hits: [
            {
              project_id: 'AANobbMI',
              slug: 'sodium',
              title: 'Sodium',
              description: 'd',
              icon_url: null,
              downloads: 5
            }
          ],
          total_hits: 1
        }
      },
      { body: { hits: [], total_hits: 0 } }
    )
    const r = await client.search(contentTarget('fabric')!, '1.21.4', 'sodium', 20)
    expect(r).toEqual({
      hits: [
        {
          project_id: 'AANobbMI',
          slug: 'sodium',
          title: 'Sodium',
          description: 'd',
          icon_url: null,
          downloads: 5
        }
      ],
      total: 1
    })
    const p = params(seen[0].url)
    expect(seen[0].url.startsWith('https://mr.test/v2/search?')).toBe(true)
    expect(p.get('query')).toBe('sodium')
    expect(p.get('index')).toBe('relevance')
    expect(p.get('offset')).toBe('20')
    expect(p.get('limit')).toBe('20')
    expect(JSON.parse(p.get('facets')!)).toEqual(searchFacets(contentTarget('fabric')!, '1.21.4'))
    expect(seen[0].headers['User-Agent']).toBe('Blockhost/test (x)')

    await client.search(contentTarget('fabric')!, '1.21.4', '', 0)
    expect(params(seen[1].url).get('index')).toBe('downloads')
    expect(params(seen[1].url).has('query')).toBe(false)
  })

  it('lists versions filtered by loaders and game version', async () => {
    const { seen, client } = fake({ body: [] })
    await client.versions('AANobbMI', ['fabric'], '1.21.4')
    const u = new URL(seen[0].url)
    expect(u.pathname).toBe('/v2/project/AANobbMI/version')
    expect(JSON.parse(u.searchParams.get('loaders')!)).toEqual(['fabric'])
    expect(JSON.parse(u.searchParams.get('game_versions')!)).toEqual(['1.21.4'])
  })

  it('fetches projects in bulk and single projects and versions', async () => {
    const { seen, client } = fake(
      { body: [{ id: 'a' }] },
      { body: { id: 'b' } },
      { body: { id: 'v' } }
    )
    expect(await client.projects(['a'])).toEqual([{ id: 'a' }])
    expect(JSON.parse(params(seen[0].url).get('ids')!)).toEqual(['a'])
    await client.project('sodium')
    expect(new URL(seen[1].url).pathname).toBe('/v2/project/sodium')
    await client.version('v')
    expect(new URL(seen[2].url).pathname).toBe('/v2/version/v')
  })

  it('identifies and checks updates by sha1 with POST bodies', async () => {
    const { seen, client } = fake({ body: { h1: { id: 'v1' } } }, { body: { h1: { id: 'v2' } } })
    expect(await client.identify(['h1'])).toEqual({ h1: { id: 'v1' } })
    expect(seen[0]).toMatchObject({ method: 'POST', body: { hashes: ['h1'], algorithm: 'sha1' } })
    expect(new URL(seen[0].url).pathname).toBe('/v2/version_files')
    await client.latest(['h1'], ['fabric'], '1.21.4')
    expect(seen[1]).toMatchObject({
      method: 'POST',
      body: {
        hashes: ['h1'],
        algorithm: 'sha1',
        loaders: ['fabric'],
        game_versions: ['1.21.4'],
        version_types: ['release']
      }
    })
    expect(new URL(seen[1].url).pathname).toBe('/v2/version_files/update')
  })

  it('skips the request for an empty hash list', async () => {
    const { seen, client } = fake()
    expect(await client.identify([])).toEqual({})
    expect(await client.latest([], ['fabric'], '1.21.4')).toEqual({})
    expect(seen).toHaveLength(0)
  })

  it('waits out a rate limit once and retries', async () => {
    const { seen, client, sleep } = fake(
      { status: 429, body: {}, headers: { 'X-Ratelimit-Reset': '7' } },
      { body: { id: 'v' } }
    )
    expect(await client.version('v')).toEqual({ id: 'v' })
    expect(sleep).toHaveBeenCalledWith(7000)
    expect(seen).toHaveLength(2)
  })

  it('maps errors', async () => {
    const { client } = fake(
      { status: 404, body: { error: 'not_found' } },
      { status: 429, body: {}, headers: { 'X-Ratelimit-Reset': '1' } },
      { status: 429, body: {} }
    )
    await expect(client.project('nope')).rejects.toMatchObject({
      code: 'CONTENT_SOURCE_API',
      details: { status: 404 }
    })
    await expect(client.project('busy')).rejects.toMatchObject({
      code: 'CONTENT_SOURCE_API',
      details: { status: 429 }
    })

    const offline = createModrinthClient({
      userAgent: 'x',
      fetchImpl: (async () => {
        throw new Error('getaddrinfo ENOTFOUND')
      }) as unknown as typeof fetch
    })
    await expect(offline.project('a')).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('times out slow requests', async () => {
    const hanging = createModrinthClient({
      userAgent: 'x',
      timeoutMs: 20,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })) as unknown as typeof fetch
    })
    await expect(hanging.project('a')).rejects.toMatchObject({
      code: 'NETWORK',
      message: expect.stringContaining('did not respond')
    })
  })

  it('adds a category facet and honours an explicit index', async () => {
    const { seen, client } = fake({ body: { hits: [], total_hits: 0 } })
    await client.search(contentTarget('fabric')!, '1.21.4', '', 0, {
      index: 'updated',
      categories: ['optimization', 'utility']
    })
    const p = params(seen[0].url)
    expect(p.get('index')).toBe('updated')
    expect(JSON.parse(p.get('facets')!)).toContainEqual([
      'categories:optimization',
      'categories:utility'
    ])
  })

  it('lists all versions and asks for betas only when included', async () => {
    const { seen, client } = fake({ body: [] }, { body: {} })
    await client.allVersions('AANobbMI')
    expect(seen[0].url).toBe('https://mr.test/v2/project/AANobbMI/version')
    await client.latest(['h'], ['fabric'], '1.21.4', true)
    expect(seen[1].body).toMatchObject({ version_types: ['release', 'beta'] })
  })
})

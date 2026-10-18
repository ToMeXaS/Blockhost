import { describe, expect, it, vi } from 'vitest'
import { JsonCache } from '../cache'
import { tempDir } from '../test-utils'
import { createHttpClient, USER_AGENT } from './http'

const URL_A = 'https://x.test/a'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function offlineFetch(): typeof fetch {
  return (async () => {
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch
}

describe('createHttpClient', () => {
  it('fetches JSON with a User-Agent header', async () => {
    const inits: RequestInit[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      inits.push(init)
      return jsonResponse({ ok: 1 })
    }) as unknown as typeof fetch
    const http = createHttpClient({ fetchImpl })
    expect(await http.getJson(URL_A)).toEqual({ ok: 1 })
    expect((inits[0].headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT)
  })

  it('serves a fresh cache entry without fetching', async () => {
    const cache = new JsonCache(await tempDir())
    await cache.set(URL_A, { cached: true })
    const fetchImpl = vi.fn()
    const http = createHttpClient({ cache, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await http.getJson(URL_A)).toEqual({ cached: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('stores fetched JSON in the cache', async () => {
    const cache = new JsonCache(await tempDir())
    const http = createHttpClient({
      cache,
      fetchImpl: (async () => jsonResponse([1, 2])) as unknown as typeof fetch
    })
    await http.getJson(URL_A)
    expect(await cache.getStale(URL_A)).toEqual([1, 2])
  })

  it('falls back to a stale cache entry when offline and reports it', async () => {
    let now = 0
    const cache = new JsonCache(await tempDir(), () => now)
    await cache.set(URL_A, { old: true })
    now = 10_000_000
    const onStale = vi.fn()
    const http = createHttpClient({ cache, ttlMs: 1000, onStale, fetchImpl: offlineFetch() })
    expect(await http.getJson(URL_A)).toEqual({ old: true })
    expect(onStale).toHaveBeenCalledWith(URL_A)
  })

  it('throws NETWORK when offline without a cache entry', async () => {
    const http = createHttpClient({ fetchImpl: offlineFetch() })
    await expect(http.getJson(URL_A)).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('throws HTTP on non-2xx responses', async () => {
    const http = createHttpClient({
      fetchImpl: (async () => jsonResponse({}, 404)) as unknown as typeof fetch
    })
    await expect(http.getJson(URL_A)).rejects.toMatchObject({ code: 'HTTP' })
    await expect(http.getText(URL_A)).rejects.toMatchObject({ code: 'HTTP' })
  })

  it('includes the status code in HTTP errors', async () => {
    const fetchImpl = (async () => jsonResponse({}, 404)) as unknown as typeof fetch
    const http = createHttpClient({ fetchImpl })
    await expect(http.getText('https://api.example.com/x')).rejects.toMatchObject({
      code: 'HTTP',
      details: { status: 404 }
    })
  })
})

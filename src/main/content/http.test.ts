import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../errors'
import { createSourceHttp, isNotFound, isSourceDown } from './http'

function fake(
  ...responses: { status?: number; body: unknown; headers?: Record<string, string> }[]
) {
  const seen: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    seen.push({ url, init })
    const r = responses.shift()!
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers })
  }) as unknown as typeof fetch
  const sleep = vi.fn(async () => {})
  const http = createSourceHttp({
    source: 'hangar',
    label: 'Hangar',
    base: 'https://h.test/api',
    userAgent: 'Blockhost/test (x)',
    fetchImpl,
    sleep,
    resetHeader: 'Retry-After'
  })
  return { http, seen, sleep }
}

describe('createSourceHttp', () => {
  it('sends GET with the user agent and POST with a JSON body', async () => {
    const { http, seen } = fake({ body: { a: 1 } }, { body: { b: 2 } })
    expect(await http.json('/x')).toEqual({ a: 1 })
    expect(await http.json('/y', { q: 1 })).toEqual({ b: 2 })
    expect(seen[0].url).toBe('https://h.test/api/x')
    expect((seen[0].init.headers as Record<string, string>)['User-Agent']).toBe(
      'Blockhost/test (x)'
    )
    expect(seen[1].init.method).toBe('POST')
    expect(seen[1].init.body).toBe('{"q":1}')
  })

  it('returns response headers when asked', async () => {
    const { http } = fake({ body: [], headers: { 'X-Page-Count': '7' } })
    const r = await http.jsonWithHeaders<unknown[]>('/list')
    expect(r.headers.get('X-Page-Count')).toBe('7')
  })

  it('waits out one rate limit using the configured header', async () => {
    const { http, sleep } = fake(
      { status: 429, body: {}, headers: { 'Retry-After': '3' } },
      { body: 1 }
    )
    expect(await http.json('/x')).toBe(1)
    expect(sleep).toHaveBeenCalledWith(3000)
  })

  it('maps HTTP errors with source and status', async () => {
    const { http } = fake({ status: 404, body: {} })
    const err = (await http.json('/missing').catch((e) => e)) as AppError
    expect(err).toMatchObject({
      code: 'CONTENT_SOURCE_API',
      details: { status: 404, source: 'hangar' }
    })
    expect(err.message).toContain('Hangar')
    expect(isNotFound(err)).toBe(true)
    expect(isSourceDown(err)).toBe(true)
    expect(isSourceDown(new AppError('NETWORK', 'x'))).toBe(true)
    expect(isSourceDown(new AppError('CONTENT_IO', 'x'))).toBe(false)
  })

  it('maps network failures and timeouts', async () => {
    const offline = createSourceHttp({
      source: 'spigot',
      label: 'SpigotMC',
      base: 'https://s.test',
      userAgent: 'x',
      fetchImpl: (async () => {
        throw new Error('ENOTFOUND')
      }) as unknown as typeof fetch
    })
    await expect(offline.json('/a')).rejects.toMatchObject({ code: 'NETWORK' })
    const hanging = createSourceHttp({
      source: 'spigot',
      label: 'SpigotMC',
      base: 'https://s.test',
      userAgent: 'x',
      timeoutMs: 20,
      fetchImpl: ((_u: string, init: RequestInit) =>
        new Promise((_r, reject) =>
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        )) as unknown as typeof fetch
    })
    await expect(hanging.json('/a')).rejects.toMatchObject({
      code: 'NETWORK',
      message: expect.stringContaining('did not respond')
    })
  })
})

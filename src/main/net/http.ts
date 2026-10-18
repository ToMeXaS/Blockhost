import type { JsonCache } from '../cache'
import { AppError } from '../errors'

export const USER_AGENT = 'Blockhost/0.1.0 (Minecraft server manager)'

export interface HttpClient {
  getJson<T>(url: string): Promise<T>
  getText(url: string): Promise<string>
}

export interface HttpClientOptions {
  cache?: JsonCache
  ttlMs?: number
  fetchImpl?: typeof fetch
  /** Called when a stale cache entry is served because the network failed. */
  onStale?: (url: string) => void
}

export function createHttpClient(opts: HttpClientOptions = {}): HttpClient {
  const fetchImpl = opts.fetchImpl ?? fetch
  const ttlMs = opts.ttlMs ?? 60 * 60 * 1000

  async function request(url: string): Promise<Response> {
    const host = new URL(url).host
    let res: Response
    try {
      res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } })
    } catch (err) {
      throw new AppError('NETWORK', `Could not reach ${host}: ${(err as Error).message}`)
    }
    if (!res.ok)
      throw new AppError('HTTP', `${host} returned HTTP ${res.status}`, { status: res.status })
    return res
  }

  return {
    async getJson<T>(url: string): Promise<T> {
      const { cache } = opts
      if (cache) {
        const fresh = await cache.getFresh(url, ttlMs)
        if (fresh !== undefined) return fresh as T
      }
      try {
        const value = (await (await request(url)).json()) as T
        await cache?.set(url, value)
        return value
      } catch (err) {
        if (cache && err instanceof AppError && err.code === 'NETWORK') {
          const stale = await cache.getStale(url)
          if (stale !== undefined) {
            opts.onStale?.(url)
            return stale as T
          }
        }
        throw err
      }
    },

    async getText(url: string): Promise<string> {
      return (await request(url)).text()
    }
  }
}

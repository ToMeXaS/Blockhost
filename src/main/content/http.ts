import type { ContentSource } from '../../shared/types'
import { AppError } from '../errors'

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RATE_LIMIT_WAIT_S = 60

export interface SourceHttpOptions {
  source: ContentSource
  /** Shown in error messages, e.g. "Modrinth". */
  label: string
  base: string
  userAgent: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  /** Response header holding the seconds until a rate limit resets. */
  resetHeader?: string
}

export interface SourceHttp {
  json<T>(path: string, body?: unknown): Promise<T>
  jsonWithHeaders<T>(path: string): Promise<{ data: T; headers: Headers }>
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export function createSourceHttp(opts: SourceHttpOptions): SourceHttp {
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const sleep = opts.sleep ?? defaultSleep
  const resetHeader = opts.resetHeader ?? 'Retry-After'

  async function send(path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { 'User-Agent': opts.userAgent }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    try {
      return await fetchImpl(`${opts.base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (err) {
      const name = (err as Error)?.name
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new AppError('NETWORK', `${opts.label} did not respond in time.`)
      }
      throw new AppError('NETWORK', `Could not reach ${opts.label}: ${(err as Error).message}`)
    }
  }

  async function request<T>(path: string, body?: unknown): Promise<{ data: T; headers: Headers }> {
    let res = await send(path, body)
    if (res.status === 429) {
      const reset = Number(res.headers.get(resetHeader))
      const seconds = Number.isFinite(reset)
        ? Math.min(Math.max(reset, 1), MAX_RATE_LIMIT_WAIT_S)
        : 1
      await sleep(seconds * 1000)
      res = await send(path, body)
    }
    const details = { status: res.status, source: opts.source }
    if (!res.ok) {
      throw new AppError('CONTENT_SOURCE_API', `${opts.label} returned HTTP ${res.status}`, details)
    }
    try {
      return { data: (await res.json()) as T, headers: res.headers }
    } catch {
      throw new AppError(
        'CONTENT_SOURCE_API',
        `${opts.label} returned an unreadable response`,
        details
      )
    }
  }

  return {
    json: async <T>(path: string, body?: unknown) => (await request<T>(path, body)).data,
    jsonWithHeaders: <T>(path: string) => request<T>(path)
  }
}

export function isNotFound(err: unknown): boolean {
  return err instanceof AppError && err.code === 'CONTENT_SOURCE_API' && err.details?.status === 404
}

/** True for failures that mean "this source is unreachable right now". */
export function isSourceDown(err: unknown): boolean {
  return err instanceof AppError && (err.code === 'NETWORK' || err.code === 'CONTENT_SOURCE_API')
}

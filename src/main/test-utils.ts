import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from './errors'
import type { HttpClient } from './net/http'

export function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'blockhost-test-'))
}

/** HttpClient that answers from a url -> value map and records requested URLs. */
export function fakeHttp(routes: Record<string, unknown>): HttpClient & { requested: string[] } {
  const requested: string[] = []
  const lookup = (url: string): unknown => {
    requested.push(url)
    if (!(url in routes)) throw new AppError('HTTP', `Unexpected URL in test: ${url}`)
    return routes[url]
  }
  return {
    requested,
    async getJson<T>(url: string): Promise<T> {
      return lookup(url) as T
    },
    async getText(url: string): Promise<string> {
      return String(lookup(url))
    }
  }
}

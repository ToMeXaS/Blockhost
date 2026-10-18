import { AppError } from '../errors'
import type { ContentTarget } from './loaders'

export const MODRINTH_API = 'https://api.modrinth.com/v2'
export const SEARCH_LIMIT = 20
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RATE_LIMIT_WAIT_S = 60

export interface ModrinthFile {
  url: string
  filename: string
  primary: boolean
  size: number
  hashes: { sha1: string; sha512: string }
}

export interface ModrinthDependency {
  project_id: string | null
  version_id: string | null
  file_name: string | null
  dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded'
}

export interface ModrinthVersion {
  id: string
  project_id: string
  version_number: string
  version_type: 'release' | 'beta' | 'alpha'
  loaders: string[]
  game_versions: string[]
  dependencies: ModrinthDependency[]
  files: ModrinthFile[]
}

export interface ModrinthProject {
  id: string
  slug: string
  title: string
  icon_url: string | null
  server_side: string
}

export interface ModrinthSearchHit {
  project_id: string
  slug: string
  title: string
  description: string
  icon_url: string | null
  downloads: number
}

export interface ModrinthClient {
  search(
    target: ContentTarget,
    mcVersion: string,
    query: string,
    offset: number
  ): Promise<{ hits: ModrinthSearchHit[]; total: number }>
  project(idOrSlug: string): Promise<ModrinthProject>
  projects(ids: string[]): Promise<ModrinthProject[]>
  version(id: string): Promise<ModrinthVersion>
  versions(projectId: string, loaders: string[], mcVersion: string): Promise<ModrinthVersion[]>
  identify(sha1s: string[]): Promise<Record<string, ModrinthVersion>>
  latest(
    sha1s: string[],
    loaders: string[],
    mcVersion: string
  ): Promise<Record<string, ModrinthVersion>>
}

export interface ModrinthClientOptions {
  userAgent: string
  fetchImpl?: typeof fetch
  base?: string
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

export function searchFacets(target: ContentTarget, mcVersion: string): string[][] {
  return [
    [`project_type:${target.projectType}`],
    target.loaders.map((loader) => `categories:${loader}`),
    [`versions:${mcVersion}`],
    ['server_side:required', 'server_side:optional']
  ]
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
const enc = (value: unknown): string => encodeURIComponent(JSON.stringify(value))

export function createModrinthClient(opts: ModrinthClientOptions): ModrinthClient {
  const fetchImpl = opts.fetchImpl ?? fetch
  const base = opts.base ?? MODRINTH_API
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const sleep = opts.sleep ?? defaultSleep

  async function send(path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { 'User-Agent': opts.userAgent }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    try {
      return await fetchImpl(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (err) {
      const name = (err as Error)?.name
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new AppError('NETWORK', 'Modrinth did not respond in time.')
      }
      throw new AppError('NETWORK', `Could not reach Modrinth: ${(err as Error).message}`)
    }
  }

  async function request<T>(path: string, body?: unknown): Promise<T> {
    let res = await send(path, body)
    if (res.status === 429) {
      const reset = Number(res.headers.get('X-Ratelimit-Reset'))
      const seconds = Number.isFinite(reset)
        ? Math.min(Math.max(reset, 1), MAX_RATE_LIMIT_WAIT_S)
        : 1
      await sleep(seconds * 1000)
      res = await send(path, body)
    }
    if (!res.ok) {
      throw new AppError('MODRINTH_API', `Modrinth returned HTTP ${res.status}`, {
        status: res.status
      })
    }
    try {
      return (await res.json()) as T
    } catch {
      throw new AppError('MODRINTH_API', 'Modrinth returned an unreadable response', {
        status: res.status
      })
    }
  }

  return {
    async search(target, mcVersion, query, offset) {
      const q = query.trim()
      const parts = [
        ...(q ? [`query=${encodeURIComponent(q)}`] : []),
        `facets=${enc(searchFacets(target, mcVersion))}`,
        `index=${q ? 'relevance' : 'downloads'}`,
        `offset=${offset}`,
        `limit=${SEARCH_LIMIT}`
      ]
      const r = await request<{ hits: ModrinthSearchHit[]; total_hits: number }>(
        `/search?${parts.join('&')}`
      )
      return { hits: r.hits, total: r.total_hits }
    },
    project: (idOrSlug) => request<ModrinthProject>(`/project/${encodeURIComponent(idOrSlug)}`),
    projects: (ids) =>
      ids.length ? request<ModrinthProject[]>(`/projects?ids=${enc(ids)}`) : Promise.resolve([]),
    version: (id) => request<ModrinthVersion>(`/version/${encodeURIComponent(id)}`),
    versions: (projectId, loaders, mcVersion) =>
      request<ModrinthVersion[]>(
        `/project/${encodeURIComponent(projectId)}/version?loaders=${enc(loaders)}&game_versions=${enc([mcVersion])}`
      ),
    identify: async (sha1s) =>
      sha1s.length
        ? request<Record<string, ModrinthVersion>>('/version_files', {
            hashes: sha1s,
            algorithm: 'sha1'
          })
        : {},
    latest: async (sha1s, loaders, mcVersion) =>
      sha1s.length
        ? request<Record<string, ModrinthVersion>>('/version_files/update', {
            hashes: sha1s,
            algorithm: 'sha1',
            loaders,
            game_versions: [mcVersion]
          })
        : {}
  }
}

import { createSourceHttp } from './http'
import type { ContentTarget } from './loaders'

export const MODRINTH_API = 'https://api.modrinth.com/v2'
export const SEARCH_LIMIT = 20

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
  date_published?: string
}

export interface ModrinthProject {
  id: string
  slug: string
  title: string
  icon_url: string | null
  server_side: string
  project_type?: string
  description?: string
  body?: string
  updated?: string
  downloads?: number
  license?: { id: string; name: string } | null
  gallery?: { url: string; title: string | null; ordering: number }[]
  source_url?: string | null
  issues_url?: string | null
  wiki_url?: string | null
  discord_url?: string | null
}

export interface ModrinthSearchHit {
  project_id: string
  slug: string
  title: string
  description: string
  icon_url: string | null
  downloads: number
  author?: string
  date_modified?: string
}

export type ModrinthIndex = 'relevance' | 'downloads' | 'updated' | 'newest'

export interface ModrinthSearchOptions {
  /** Defaults to relevance with a query, downloads without one. */
  index?: ModrinthIndex
  /** OR-group of Modrinth category names. */
  categories?: string[]
}

export interface ModrinthClient {
  search(
    target: ContentTarget,
    mcVersion: string,
    query: string,
    offset: number,
    opts?: ModrinthSearchOptions
  ): Promise<{ hits: ModrinthSearchHit[]; total: number }>
  project(idOrSlug: string): Promise<ModrinthProject>
  projects(ids: string[]): Promise<ModrinthProject[]>
  version(id: string): Promise<ModrinthVersion>
  versions(projectId: string, loaders: string[], mcVersion: string): Promise<ModrinthVersion[]>
  /** Every version of the project, newest first, unfiltered. */
  allVersions(projectId: string): Promise<ModrinthVersion[]>
  identify(sha1s: string[]): Promise<Record<string, ModrinthVersion>>
  latest(
    sha1s: string[],
    loaders: string[],
    mcVersion: string,
    includeBeta?: boolean
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

const enc = (value: unknown): string => encodeURIComponent(JSON.stringify(value))

export function createModrinthClient(opts: ModrinthClientOptions): ModrinthClient {
  const http = createSourceHttp({
    source: 'modrinth',
    label: 'Modrinth',
    base: opts.base ?? MODRINTH_API,
    userAgent: opts.userAgent,
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
    sleep: opts.sleep,
    resetHeader: 'X-Ratelimit-Reset'
  })
  const request = <T>(path: string, body?: unknown): Promise<T> => http.json<T>(path, body)

  return {
    async search(target, mcVersion, query, offset, searchOpts = {}) {
      const q = query.trim()
      const facets = searchFacets(target, mcVersion)
      if (searchOpts.categories?.length) {
        facets.push(searchOpts.categories.map((c) => `categories:${c}`))
      }
      const index = searchOpts.index ?? (q ? 'relevance' : 'downloads')
      const parts = [
        ...(q ? [`query=${encodeURIComponent(q)}`] : []),
        `facets=${enc(facets)}`,
        `index=${index}`,
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
    allVersions: (projectId) =>
      request<ModrinthVersion[]>(`/project/${encodeURIComponent(projectId)}/version`),
    identify: async (sha1s) =>
      sha1s.length
        ? request<Record<string, ModrinthVersion>>('/version_files', {
            hashes: sha1s,
            algorithm: 'sha1'
          })
        : {},
    latest: async (sha1s, loaders, mcVersion, includeBeta = false) =>
      sha1s.length
        ? request<Record<string, ModrinthVersion>>('/version_files/update', {
            hashes: sha1s,
            algorithm: 'sha1',
            loaders,
            game_versions: [mcVersion],
            // Stable releases only unless the server opted into betas (Modrinth honours this).
            version_types: includeBeta ? ['release', 'beta'] : ['release']
          })
        : {}
  }
}

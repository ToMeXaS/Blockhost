import type {
  ContentCategory,
  ContentChannel,
  ContentLinkKind,
  ContentSort
} from '../../../shared/types'
import { createSourceHttp, isNotFound } from '../http'
import type { ContentProvider, Hit, ProjectInfo, Version } from '../types'

export const HANGAR_API = 'https://hangar.papermc.io/api/v1'
const PLATFORM = 'PAPER'
const VERSION_PAGE = 25

interface HangarProject {
  name: string
  namespace: { owner: string; slug: string }
  stats: { downloads: number }
  description: string
  lastUpdated: string
  avatarUrl?: string | null
  mainPageContent?: string | null
  settings?: {
    links?: { links?: { name: string; url: string }[] }[]
    license?: { name?: string | null; type?: string | null } | null
  }
}

interface HangarVersion {
  id: number
  name: string
  createdAt: string
  channel: { name: string }
  platformDependencies: Record<string, string[]>
  pluginDependencies?: Record<
    string,
    {
      name: string
      projectId: number | string | null
      required: boolean
      externalUrl: string | null
    }[]
  >
  downloads: Record<
    string,
    {
      fileInfo: { name: string; sizeBytes: number; sha256Hash: string } | null
      downloadUrl: string | null
      externalUrl: string | null
    }
  >
}

const CATEGORIES: Partial<Record<ContentCategory, string[]>> = {
  admin: ['admin_tools'],
  economy: ['economy'],
  worldgen: ['world_management'],
  gameplay: ['gameplay', 'games', 'role_playing'],
  chat: ['chat'],
  protection: ['protection'],
  utility: ['misc'],
  library: ['dev_tools']
}

const SORTS: Record<Exclude<ContentSort, 'relevance'>, string> = {
  downloads: '-downloads',
  updated: '-updated',
  newest: '-newest'
}

function channelOf(name: string): ContentChannel {
  const n = name.toLowerCase()
  if (n === 'release') return 'release'
  if (n.includes('alpha')) return 'alpha'
  return 'beta'
}

function linkKind(name: string, url: string): ContentLinkKind {
  const s = `${name} ${url}`.toLowerCase()
  if (s.includes('discord')) return 'discord'
  if (s.includes('issue') || s.includes('bug')) return 'issues'
  if (s.includes('wiki') || s.includes('docs') || s.includes('documentation')) return 'wiki'
  if (s.includes('source') || s.includes('github') || s.includes('gitlab')) return 'source'
  return 'other'
}

const pageUrl = (p: HangarProject): string =>
  `https://hangar.papermc.io/${p.namespace.owner}/${p.namespace.slug}`

function toVersion(projectId: string, v: HangarVersion): Version {
  const dl = v.downloads[PLATFORM]
  return {
    id: String(v.id),
    projectId,
    versionNumber: v.name,
    channel: channelOf(v.channel.name),
    publishedAt: v.createdAt,
    mcVersions: v.platformDependencies[PLATFORM] ?? [],
    loaders: ['paper'],
    file: {
      url: dl?.downloadUrl ?? null,
      externalUrl: dl?.downloadUrl ? null : (dl?.externalUrl ?? null),
      filename: dl?.fileInfo?.name ?? '',
      size: dl?.fileInfo?.sizeBytes ?? null,
      hash: dl?.fileInfo ? { algo: 'sha256', value: dl.fileInfo.sha256Hash } : null,
      sha1: null
    },
    dependencies: (v.pluginDependencies?.[PLATFORM] ?? []).map((d) => ({
      projectId: d.projectId === null ? null : String(d.projectId),
      versionId: null,
      kind: d.required ? 'required' : 'optional',
      name: d.name,
      externalUrl: d.externalUrl
    }))
  }
}

export function hangarProvider(opts: {
  userAgent: string
  fetchImpl?: typeof fetch
  base?: string
  sleep?: (ms: number) => Promise<void>
}): ContentProvider {
  const http = createSourceHttp({
    source: 'hangar',
    label: 'Hangar',
    base: opts.base ?? HANGAR_API,
    userAgent: opts.userAgent,
    fetchImpl: opts.fetchImpl,
    sleep: opts.sleep,
    resetHeader: 'Retry-After'
  })

  async function allVersions(projectId: string): Promise<Version[]> {
    const r = await http.json<{ result: HangarVersion[] }>(
      `/projects/${encodeURIComponent(projectId)}/versions?limit=${VERSION_PAGE}&offset=0&platform=${PLATFORM}`
    )
    // Hangar returns newest first.
    return r.result.map((v) => toVersion(projectId, v))
  }

  return {
    id: 'hangar',
    label: 'Hangar',
    supports: (target) => target.projectType === 'plugin',
    downloadHosts: ['hangarcdn.papermc.io'],
    categories: CATEGORIES,

    async search(q) {
      const params = new URLSearchParams({
        limit: String(q.limit),
        offset: String(q.offset),
        platform: PLATFORM,
        version: q.mcVersion
      })
      const text = q.text.trim()
      if (text) params.set('q', text)
      const sort = q.sort === 'relevance' ? (text ? null : SORTS.downloads) : SORTS[q.sort]
      if (sort) params.set('sort', sort)
      // Hangar filters on a single category, so only the first mapped id is used.
      const category = q.category ? CATEGORIES[q.category]?.[0] : undefined
      if (category) params.set('category', category)
      const r = await http.json<{ pagination: { count: number }; result: HangarProject[] }>(
        `/projects?${params}`
      )
      return {
        total: r.pagination.count,
        hits: r.result.map((p): Hit => ({
          source: 'hangar',
          projectId: p.namespace.slug,
          slug: p.namespace.slug,
          title: p.name,
          author: p.namespace.owner,
          description: p.description,
          iconUrl: p.avatarUrl ?? null,
          downloads: p.stats.downloads,
          updatedAt: p.lastUpdated,
          untestedOnVersion: false
        }))
      }
    },

    async project(idOrSlug): Promise<ProjectInfo> {
      const p = await http.json<HangarProject>(`/projects/${encodeURIComponent(idOrSlug)}`)
      // The project endpoint leaves mainPageContent null; the page is served as plain markdown.
      const page = await http
        .text(`/pages/main/${encodeURIComponent(p.namespace.slug)}`)
        .catch((err) => {
          if (isNotFound(err)) return ''
          throw err
        })
      const extra = (p.settings?.links ?? [])
        .flatMap((g) => g.links ?? [])
        .filter((l) => /^https:\/\//.test(l.url))
      return {
        id: p.namespace.slug,
        slug: p.namespace.slug,
        title: p.name,
        author: p.namespace.owner,
        summary: p.description,
        iconUrl: p.avatarUrl ?? null,
        downloads: p.stats.downloads,
        updatedAt: p.lastUpdated,
        license: p.settings?.license?.name || p.settings?.license?.type || null,
        description: { format: 'markdown', body: page || p.mainPageContent || '' },
        gallery: [],
        links: [
          { kind: 'page', url: pageUrl(p) },
          ...extra.map((l) => ({ kind: linkKind(l.name, l.url), url: l.url }))
        ],
        pageUrl: pageUrl(p)
      }
    },

    allVersions,
    async versions(projectId, _target, mcVersion) {
      return (await allVersions(projectId)).filter((v) => v.mcVersions.includes(mcVersion))
    }
  }
}

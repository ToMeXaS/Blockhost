import type { ContentCategory, ContentLinkKind, ContentSort } from '../../../shared/types'
import { createSourceHttp } from '../http'
import type { ContentProvider, Hit, ProjectInfo, ProviderQuery, Version } from '../types'

export const SPIGET_API = 'https://api.spiget.org/v2'
const FIELDS =
  'id,name,tag,downloads,updateDate,releaseDate,icon,testedVersions,external,premium,file,version,category'

/** SpigotMC categories under "Spigot" plus "Universal"; everything else is proxy-only or not a plugin. */
const PLUGIN_CATEGORIES = new Set([4, 14, 15, 16, 17, 18, 21, 22, 23, 24, 26])

const CATEGORIES: Partial<Record<ContentCategory, string[]>> = {
  chat: ['14'],
  utility: ['15'],
  worldgen: ['18'],
  gameplay: ['22', '24', '17'],
  economy: ['23'],
  library: ['26']
}

const SORTS: Record<Exclude<ContentSort, 'relevance'>, string> = {
  downloads: '-downloads',
  updated: '-updateDate',
  newest: '-releaseDate'
}

interface SpigetResource {
  id: number
  name: string
  tag: string
  downloads: number
  updateDate: number
  releaseDate: number
  icon?: { url?: string }
  testedVersions?: string[]
  external: boolean
  premium?: boolean
  file?: { type: string; size: number; sizeUnit: string; url: string; externalUrl?: string }
  version?: { id: number }
  category?: { id: number }
  description?: string
  links?: Record<string, string>
}

export function isTestedOn(tested: string[], mcVersion: string): boolean {
  const majorMinor = mcVersion.split('.').slice(0, 2).join('.')
  return tested.includes(mcVersion) || tested.includes(majorMinor)
}

const iso = (seconds: number | undefined): string | null =>
  seconds ? new Date(seconds * 1000).toISOString() : null
const iconOf = (r: SpigetResource): string | null =>
  r.icon?.url ? `https://www.spigotmc.org/${r.icon.url}` : null
const pageOf = (id: number | string): string => `https://www.spigotmc.org/resources/${id}`

function linkKind(name: string, url: string): ContentLinkKind {
  const s = `${name} ${url}`.toLowerCase()
  if (s.includes('discord')) return 'discord'
  if (s.includes('issue') || s.includes('bug')) return 'issues'
  if (s.includes('wiki') || s.includes('docs') || s.includes('documentation')) return 'wiki'
  if (s.includes('source') || s.includes('github') || s.includes('gitlab')) return 'source'
  return 'other'
}

/** Spiget gives no file name; make a safe .jar name from the resource name and version. */
export function jarName(name: string, version: string): string {
  const base = `${name}-${version}`
    .replace(/[^A-Za-z0-9._+-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return `${base.slice(0, 120) || 'plugin'}.jar`
}

export function spigetProvider(opts: {
  userAgent: string
  fetchImpl?: typeof fetch
  base?: string
  sleep?: (ms: number) => Promise<void>
}): ContentProvider {
  const http = createSourceHttp({
    source: 'spigot',
    label: 'SpigotMC',
    base: opts.base ?? SPIGET_API,
    userAgent: opts.userAgent,
    fetchImpl: opts.fetchImpl,
    sleep: opts.sleep,
    resetHeader: 'Retry-After'
  })

  const resource = (id: string): Promise<SpigetResource> =>
    http.json<SpigetResource>(
      `/resources/${encodeURIComponent(id)}?fields=${FIELDS},description,links`
    )

  async function latest(id: string): Promise<Version> {
    const r = await resource(id)
    const v = await http.json<{ id: number; name: string; releaseDate: number }>(
      `/resources/${encodeURIComponent(id)}/versions/latest`
    )
    const blocked = r.external || r.premium === true
    return {
      id: String(v.id),
      projectId: String(r.id),
      versionNumber: v.name,
      channel: 'release',
      publishedAt: iso(v.releaseDate),
      mcVersions: r.testedVersions ?? [],
      loaders: ['spigot', 'bukkit'],
      file: {
        url: blocked ? null : `${SPIGET_API}/resources/${r.id}/download`,
        externalUrl: blocked ? pageOf(r.id) : null,
        filename: jarName(r.name, v.name),
        // Spiget reports a rounded KB/MB figure, not bytes.
        size: null,
        hash: null,
        sha1: null
      },
      dependencies: []
    }
  }

  return {
    id: 'spigot',
    label: 'SpigotMC',
    supports: (target) => target.projectType === 'plugin',
    downloadHosts: ['api.spiget.org', 'cdn.spiget.org'],
    categories: CATEGORIES,
    supportsQuery: (q: ProviderQuery) => !(q.text.trim() && q.category),

    async search(q) {
      const text = q.text.trim()
      const params = new URLSearchParams({
        size: String(q.limit),
        page: String(Math.floor(q.offset / q.limit) + 1),
        fields: FIELDS
      })
      const sort = q.sort === 'relevance' ? (text ? null : SORTS.downloads) : SORTS[q.sort]
      if (sort) params.set('sort', sort)
      const category = q.category ? CATEGORIES[q.category]?.[0] : undefined
      const path = text
        ? `/search/resources/${encodeURIComponent(text)}`
        : category
          ? `/categories/${category}/resources`
          : '/resources'
      const { data, headers } = await http.jsonWithHeaders<SpigetResource[]>(`${path}?${params}`)
      const pages = Number(headers.get('X-Page-Count'))
      const total = Number.isFinite(pages) && pages > 0 ? pages * q.limit : q.offset + data.length
      return {
        total,
        // The raw page size, so paging is not cut short by the proxy-only resources filtered out below.
        fetched: data.length,
        hits: data
          .filter((r) => !r.category || PLUGIN_CATEGORIES.has(r.category.id))
          .map((r): Hit => ({
            source: 'spigot',
            projectId: String(r.id),
            slug: String(r.id),
            title: r.name,
            author: null,
            description: r.tag,
            iconUrl: iconOf(r),
            downloads: r.downloads,
            updatedAt: iso(r.updateDate),
            untestedOnVersion: !isTestedOn(r.testedVersions ?? [], q.mcVersion)
          }))
      }
    },

    async project(id): Promise<ProjectInfo> {
      const r = await resource(id)
      const links = Object.entries(r.links ?? {})
        .filter(([, url]) => /^https:\/\//.test(url))
        .map(([name, url]) => ({ kind: linkKind(name, url), url }))
      return {
        id: String(r.id),
        slug: String(r.id),
        title: r.name,
        author: null,
        summary: r.tag,
        iconUrl: iconOf(r),
        downloads: r.downloads,
        updatedAt: iso(r.updateDate),
        license: null,
        description: {
          format: 'html',
          body: r.description ? Buffer.from(r.description, 'base64').toString('utf8') : ''
        },
        gallery: [],
        links: [{ kind: 'page', url: pageOf(r.id) }, ...links],
        pageUrl: pageOf(r.id)
      }
    },

    // Spigot data is too coarse to filter by game version; the UI shows "not tested" instead.
    versions: async (projectId) => [await latest(projectId)],
    allVersions: async (projectId) => [await latest(projectId)]
  }
}

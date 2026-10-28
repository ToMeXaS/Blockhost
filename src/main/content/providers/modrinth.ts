import type { ContentCategory, ContentLinkKind } from '../../../shared/types'
import type { ModrinthClient, ModrinthIndex, ModrinthProject, ModrinthVersion } from '../modrinth'
import type { ContentProvider, Hit, Identified, ProjectInfo, Version } from '../types'

const CATEGORIES: Partial<Record<ContentCategory, string[]>> = {
  optimization: ['optimization'],
  admin: ['management'],
  economy: ['economy'],
  worldgen: ['worldgen'],
  gameplay: ['game-mechanics', 'adventure', 'minigame'],
  chat: ['social'],
  utility: ['utility'],
  library: ['library']
}

export function toVersion(v: ModrinthVersion): Version {
  const file = v.files.find((f) => f.primary) ?? v.files[0]
  return {
    id: v.id,
    projectId: v.project_id,
    versionNumber: v.version_number,
    channel: v.version_type,
    publishedAt: v.date_published ?? null,
    mcVersions: v.game_versions,
    loaders: v.loaders,
    file: file
      ? {
          url: file.url,
          externalUrl: null,
          filename: file.filename,
          size: file.size,
          hash: { algo: 'sha512', value: file.hashes.sha512 },
          sha1: file.hashes.sha1
        }
      : { url: null, externalUrl: null, filename: '', size: null, hash: null, sha1: null },
    dependencies: v.dependencies.map((d) => ({
      projectId: d.project_id,
      versionId: d.version_id,
      kind: d.dependency_type,
      name: null,
      externalUrl: null
    }))
  }
}

function pageUrl(p: ModrinthProject): string {
  return `https://modrinth.com/${p.project_type ?? 'mod'}/${p.slug}`
}

function toProject(p: ModrinthProject): ProjectInfo {
  const links: { kind: ContentLinkKind; url: string }[] = [{ kind: 'page', url: pageUrl(p) }]
  const add = (kind: ContentLinkKind, url: string | null | undefined): void => {
    if (url) links.push({ kind, url })
  }
  add('issues', p.issues_url)
  add('source', p.source_url)
  add('wiki', p.wiki_url)
  add('discord', p.discord_url)
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    author: null,
    summary: p.description ?? '',
    iconUrl: p.icon_url,
    downloads: p.downloads ?? 0,
    updatedAt: p.updated ?? null,
    license: p.license?.name ?? p.license?.id ?? null,
    description: { format: 'markdown', body: p.body ?? '' },
    gallery: [...(p.gallery ?? [])]
      .sort((a, b) => a.ordering - b.ordering)
      .map((g) => ({ url: g.url, title: g.title })),
    links,
    pageUrl: pageUrl(p)
  }
}

export function modrinthProvider(client: ModrinthClient): ContentProvider {
  return {
    id: 'modrinth',
    label: 'Modrinth',
    supports: () => true,
    downloadHosts: ['cdn.modrinth.com'],
    categories: CATEGORIES,

    async search(q) {
      const index: ModrinthIndex = !q.text.trim() && q.sort === 'relevance' ? 'downloads' : q.sort
      const r = await client.search(q.target, q.mcVersion, q.text, q.offset, {
        index,
        categories: q.category ? CATEGORIES[q.category] : undefined
      })
      return {
        total: r.total,
        hits: r.hits.map((h): Hit => ({
          source: 'modrinth',
          projectId: h.project_id,
          slug: h.slug,
          title: h.title,
          author: h.author ?? null,
          description: h.description,
          iconUrl: h.icon_url,
          downloads: h.downloads,
          updatedAt: h.date_modified ?? null,
          untestedOnVersion: false
        }))
      }
    },

    project: async (idOrSlug) => toProject(await client.project(idOrSlug)),
    versions: async (projectId, target, mcVersion) =>
      (await client.versions(projectId, target.loaders, mcVersion)).map(toVersion),
    allVersions: async (projectId) => (await client.allVersions(projectId)).map(toVersion),
    version: async (versionId) => toVersion(await client.version(versionId)),

    async identify(sha1s) {
      const found = await client.identify(sha1s)
      const ids = [...new Set(Object.values(found).map((v) => v.project_id))]
      const projects = new Map((await client.projects(ids)).map((p) => [p.id, p]))
      const out: Record<string, Identified> = {}
      for (const [sha1, v] of Object.entries(found)) {
        const p = projects.get(v.project_id)
        out[sha1] = {
          projectId: v.project_id,
          versionId: v.id,
          versionNumber: v.version_number,
          title: p?.title ?? v.project_id,
          iconUrl: p?.icon_url ?? null
        }
      }
      return out
    },

    async latest(sha1s, target, mcVersion, includeBeta) {
      const found = await client.latest(sha1s, target.loaders, mcVersion, includeBeta)
      return Object.fromEntries(Object.entries(found).map(([k, v]) => [k, toVersion(v)]))
    }
  }
}

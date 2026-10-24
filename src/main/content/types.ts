import type {
  ContentCategory,
  ContentChannel,
  ContentLinkKind,
  ContentSort,
  ContentSource
} from '../../shared/types'
import type { ContentTarget } from './loaders'

export interface VersionFile {
  /** null when this source will not let Blockhost download it. */
  url: string | null
  /** Where to send the user instead (premium, external, hosted elsewhere). */
  externalUrl: string | null
  filename: string
  /** Exact size in bytes when the source reports one. */
  size: number | null
  hash: { algo: 'sha512' | 'sha256' | 'sha1'; value: string } | null
  sha1: string | null
}

export interface VersionDependency {
  /** Same-source project id; null when the source only names the dependency. */
  projectId: string | null
  versionId: string | null
  kind: 'required' | 'optional' | 'incompatible' | 'embedded'
  /** Display name for dependencies without a projectId (Hangar external ones). */
  name: string | null
  externalUrl: string | null
}

export interface Version {
  id: string
  projectId: string
  versionNumber: string
  channel: ContentChannel
  publishedAt: string | null
  mcVersions: string[]
  loaders: string[]
  file: VersionFile
  dependencies: VersionDependency[]
}

export interface ProjectInfo {
  /** Canonical id used in the manifest (Modrinth id, Hangar slug, Spigot resource id). */
  id: string
  slug: string
  title: string
  author: string | null
  summary: string
  iconUrl: string | null
  downloads: number
  updatedAt: string | null
  license: string | null
  description: { format: 'markdown' | 'html'; body: string }
  gallery: { url: string; title: string | null }[]
  links: { kind: ContentLinkKind; url: string }[]
  pageUrl: string
}

export interface Hit {
  source: ContentSource
  projectId: string
  slug: string
  title: string
  author: string | null
  description: string
  iconUrl: string | null
  downloads: number
  updatedAt: string | null
  /** Spigot only: the server's version is not in the resource's tested versions. */
  untestedOnVersion: boolean
}

export interface Identified {
  projectId: string
  versionId: string
  versionNumber: string
  title: string
  iconUrl: string | null
}

export interface ProviderQuery {
  target: ContentTarget
  mcVersion: string
  text: string
  category: ContentCategory | null
  sort: ContentSort
  offset: number
  limit: number
}

export interface ContentProvider {
  id: ContentSource
  label: string
  supports(target: ContentTarget): boolean
  /** Hostnames a download (after redirects) may come from. */
  downloadHosts: string[]
  /** Which of this source's category ids each normalized category maps to. */
  categories: Partial<Record<ContentCategory, string[]>>
  /** False when this source cannot serve the query at all (e.g. text + category on Spiget). */
  supportsQuery?(q: ProviderQuery): boolean
  search(q: ProviderQuery): Promise<{ hits: Hit[]; total: number }>
  project(idOrSlug: string): Promise<ProjectInfo>
  /** Versions compatible with the target and game version, newest first. */
  versions(projectId: string, target: ContentTarget, mcVersion: string): Promise<Version[]>
  /** Every version, newest first (for "Show incompatible"). */
  allVersions(projectId: string): Promise<Version[]>
  /** Look one version up by id (sources whose dependencies may pin a version). */
  version?(versionId: string): Promise<Version>
  /** sha1 → what it is, for jars added by hand. */
  identify?(sha1s: string[]): Promise<Record<string, Identified>>
  /** sha1 → newest compatible version, in one request. */
  latest?(
    sha1s: string[],
    target: ContentTarget,
    mcVersion: string,
    includeBeta: boolean
  ): Promise<Record<string, Version>>
}

export function isCompatible(v: Version, loaders: string[], mcVersion: string): boolean {
  return v.mcVersions.includes(mcVersion) && v.loaders.some((l) => loaders.includes(l))
}

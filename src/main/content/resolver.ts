import { AppError } from '../errors'
import { isNotFound } from './http'
import type { ContentTarget } from './loaders'
import { isCompatible, type ContentProvider, type Version } from './types'

export interface PlanFile {
  url: string
  filename: string
  sha1: string | null
  hash: { algo: 'sha512' | 'sha256' | 'sha1'; value: string } | null
  size: number | null
}

export interface PlanItem {
  projectId: string
  versionId: string
  title: string
  versionNumber: string
  iconUrl: string | null
  file: PlanFile
  /** Same-source project ids of the planned items that need this one. */
  dependencyOf: string[]
}

/** An already-installed project that a planned item requires (so it was not planned again). */
export interface PlanLink {
  projectId: string
  parentId: string
}

/** A required dependency the source names but cannot install for us. */
export interface ManualDependency {
  title: string
  externalUrl: string | null
  neededBy: string
}

export interface Plan {
  items: PlanItem[]
  links: PlanLink[]
  manual: ManualDependency[]
  /** Project ids of the root version's optional dependencies (informational). */
  optional: string[]
}

export interface ResolveContext {
  provider: Pick<ContentProvider, 'label' | 'project' | 'versions' | 'version'>
  target: ContentTarget
  mcVersion: string
  installedProjectIds: Set<string>
  includeBeta: boolean
  /** e.g. "Paper 1.21.4", used in messages */
  targetLabel: string
}

const downloadable = (v: Version): boolean => v.file.url !== null && v.file.filename !== ''

/** `versions` is newest first. */
export function pickVersion(versions: Version[], includeBeta: boolean): Version | null {
  const usable = versions.filter(downloadable)
  if (includeBeta) {
    return usable.find((v) => v.channel !== 'alpha') ?? usable[0] ?? null
  }
  for (const channel of ['release', 'beta', 'alpha'] as const) {
    const found = usable.find((v) => v.channel === channel)
    if (found) return found
  }
  return null
}

export async function planInstall(
  projectIdOrSlug: string,
  ctx: ResolveContext,
  versionId?: string
): Promise<Plan> {
  const items: PlanItem[] = []
  const links: PlanLink[] = []
  const manual: ManualDependency[] = []
  let optional: string[] = []
  const byProject = new Map<string, PlanItem>()
  const gone = (title: string): AppError =>
    new AppError(
      'CONTENT_DEPENDENCY_UNAVAILABLE',
      `${title} needs a dependency that is no longer on ${ctx.provider.label}.`
    )

  async function compatibleVersion(id: string | null, projectId: string): Promise<Version | null> {
    if (!id || !ctx.provider.version) return null
    try {
      const v = await ctx.provider.version(id)
      return v.projectId === projectId &&
        isCompatible(v, ctx.target.loaders, ctx.mcVersion) &&
        downloadable(v)
        ? v
        : null
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async function visit(
    idOrSlug: string,
    pinned: string | null,
    parent: PlanItem | null
  ): Promise<void> {
    let project
    try {
      project = await ctx.provider.project(idOrSlug)
    } catch (err) {
      if (parent && isNotFound(err)) throw gone(parent.title)
      throw err
    }
    if (ctx.installedProjectIds.has(project.id)) {
      if (parent && parent.projectId !== project.id) {
        links.push({ projectId: project.id, parentId: parent.projectId })
      }
      return
    }
    const existing = byProject.get(project.id)
    if (existing) {
      // `existing === parent` happens when a project lists itself as a dependency.
      if (parent && existing !== parent && !existing.dependencyOf.includes(parent.projectId)) {
        existing.dependencyOf.push(parent.projectId)
      }
      return
    }

    const candidates = await ctx.provider.versions(project.id, ctx.target, ctx.mcVersion)
    const version =
      (await compatibleVersion(pinned, project.id)) ?? pickVersion(candidates, ctx.includeBeta)
    if (!version) {
      const external = candidates.find((v) => v.file.externalUrl)?.file.externalUrl ?? null
      if (parent) {
        if (external) {
          manual.push({ title: project.title, externalUrl: external, neededBy: parent.title })
          return
        }
        throw new AppError(
          'CONTENT_DEPENDENCY_UNAVAILABLE',
          `${parent.title} needs ${project.title}, which has no version for ${ctx.targetLabel}.`
        )
      }
      if (external) {
        throw new AppError(
          'CONTENT_EXTERNAL_ONLY',
          `${project.title} can't be downloaded by Blockhost. Get it from its page instead.`,
          { externalUrl: external }
        )
      }
      throw new AppError(
        'CONTENT_NO_COMPATIBLE_VERSION',
        `No version of ${project.title} supports ${ctx.targetLabel}.`
      )
    }

    const item: PlanItem = {
      projectId: project.id,
      versionId: version.id,
      title: project.title,
      versionNumber: version.versionNumber,
      iconUrl: project.iconUrl,
      file: {
        url: version.file.url!,
        filename: version.file.filename,
        sha1: version.file.sha1,
        hash: version.file.hash,
        size: version.file.size
      },
      dependencyOf: parent ? [parent.projectId] : []
    }
    items.push(item)
    byProject.set(project.id, item)
    if (!parent) {
      optional = version.dependencies
        .filter((d) => d.kind === 'optional' && d.projectId)
        .map((d) => d.projectId!)
    }

    for (const dep of version.dependencies) {
      if (
        dep.kind === 'incompatible' &&
        dep.projectId &&
        ctx.installedProjectIds.has(dep.projectId)
      ) {
        const other = await ctx.provider.project(dep.projectId)
        throw new AppError(
          'CONTENT_CONFLICT',
          `${project.title} cannot be installed together with ${other.title}.`
        )
      }
    }
    for (const dep of version.dependencies) {
      if (dep.kind !== 'required') continue
      let depProject = dep.projectId
      if (!depProject && dep.versionId && ctx.provider.version) {
        try {
          depProject = (await ctx.provider.version(dep.versionId)).projectId
        } catch (err) {
          if (isNotFound(err)) throw gone(item.title)
          throw err
        }
      }
      if (!depProject) {
        if (dep.name)
          manual.push({ title: dep.name, externalUrl: dep.externalUrl, neededBy: item.title })
        continue
      }
      await visit(depProject, dep.versionId, item)
    }
  }

  await visit(projectIdOrSlug, versionId ?? null, null)
  return { items, links, manual, optional }
}

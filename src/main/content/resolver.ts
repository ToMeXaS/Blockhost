import { AppError } from '../errors'
import { isNotFound } from './http'
import type { ModrinthClient, ModrinthFile, ModrinthVersion } from './modrinth'

export interface PlanFile {
  url: string
  filename: string
  sha1: string
  sha512: string
  size: number
}

export interface PlanItem {
  projectId: string
  versionId: string
  title: string
  versionNumber: string
  file: PlanFile
  dependencyOf: string[]
}

/** An already-installed project that a planned item requires (so it was not planned again). */
export interface PlanLink {
  projectId: string
  parentId: string
}

export interface Plan {
  items: PlanItem[]
  links: PlanLink[]
}

export interface ResolveContext {
  client: Pick<ModrinthClient, 'project' | 'version' | 'versions'>
  loaders: string[]
  mcVersion: string
  installedProjectIds: Set<string>
  /** e.g. "Paper 1.21.4", used in messages */
  targetLabel: string
}

const TYPE_ORDER: ModrinthVersion['version_type'][] = ['release', 'beta', 'alpha']

export function isCompatible(v: ModrinthVersion, loaders: string[], mcVersion: string): boolean {
  return v.game_versions.includes(mcVersion) && v.loaders.some((l) => loaders.includes(l))
}

/** `versions` is newest first, as Modrinth returns them. */
export function pickVersion(versions: ModrinthVersion[]): ModrinthVersion | null {
  for (const type of TYPE_ORDER) {
    const found = versions.find((v) => v.version_type === type && v.files.length > 0)
    if (found) return found
  }
  return null
}

export function primaryFile(v: ModrinthVersion): ModrinthFile {
  return v.files.find((f) => f.primary) ?? v.files[0]
}

export async function planInstall(
  projectIdOrSlug: string,
  ctx: ResolveContext,
  versionId?: string
): Promise<Plan> {
  const items: PlanItem[] = []
  const links: PlanLink[] = []
  const byProject = new Map<string, PlanItem>()

  async function compatibleVersion(
    id: string | null,
    projectId: string
  ): Promise<ModrinthVersion | null> {
    if (!id) return null
    try {
      const v = await ctx.client.version(id)
      return v.project_id === projectId &&
        isCompatible(v, ctx.loaders, ctx.mcVersion) &&
        v.files.length > 0
        ? v
        : null
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async function visit(
    idOrSlug: string,
    pinnedVersion: string | null,
    parent: PlanItem | null
  ): Promise<void> {
    let project
    try {
      project = await ctx.client.project(idOrSlug)
    } catch (err) {
      if (parent && isNotFound(err)) {
        throw new AppError(
          'CONTENT_DEPENDENCY_UNAVAILABLE',
          `${parent.title} needs a dependency that is no longer on Modrinth.`
        )
      }
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

    const version =
      (await compatibleVersion(pinnedVersion, project.id)) ??
      pickVersion(await ctx.client.versions(project.id, ctx.loaders, ctx.mcVersion))
    if (!version) {
      if (parent) {
        throw new AppError(
          'CONTENT_DEPENDENCY_UNAVAILABLE',
          `${parent.title} needs ${project.title}, which has no version for ${ctx.targetLabel}.`
        )
      }
      throw new AppError(
        'CONTENT_NO_COMPATIBLE_VERSION',
        `No version of ${project.title} supports ${ctx.targetLabel}.`
      )
    }

    const file = primaryFile(version)
    const item: PlanItem = {
      projectId: project.id,
      versionId: version.id,
      title: project.title,
      versionNumber: version.version_number,
      file: {
        url: file.url,
        filename: file.filename,
        sha1: file.hashes.sha1,
        sha512: file.hashes.sha512,
        size: file.size
      },
      dependencyOf: parent ? [parent.projectId] : []
    }
    items.push(item)
    byProject.set(project.id, item)

    for (const dep of version.dependencies) {
      if (
        dep.dependency_type === 'incompatible' &&
        dep.project_id &&
        ctx.installedProjectIds.has(dep.project_id)
      ) {
        const other = await ctx.client.project(dep.project_id)
        throw new AppError(
          'CONTENT_CONFLICT',
          `${project.title} cannot be installed together with ${other.title}.`
        )
      }
    }
    for (const dep of version.dependencies) {
      if (dep.dependency_type !== 'required') continue
      let depProject = dep.project_id
      if (!depProject && dep.version_id) {
        try {
          depProject = (await ctx.client.version(dep.version_id)).project_id
        } catch (err) {
          if (isNotFound(err)) {
            throw new AppError(
              'CONTENT_DEPENDENCY_UNAVAILABLE',
              `${item.title} needs a dependency that is no longer on Modrinth.`
            )
          }
          throw err
        }
      }
      if (!depProject) continue
      await visit(depProject, dep.version_id, item)
    }
  }

  await visit(projectIdOrSlug, versionId ?? null, null)
  return { items, links }
}

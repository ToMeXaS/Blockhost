import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../errors'
import type { ModrinthDependency, ModrinthProject, ModrinthVersion } from './modrinth'
import { isCompatible, pickVersion, planInstall, type ResolveContext } from './resolver'

const project = (id: string, slug: string, title: string): ModrinthProject => ({
  id,
  slug,
  title,
  icon_url: null,
  server_side: 'optional'
})

const version = (
  id: string,
  projectId: string,
  opts: {
    type?: ModrinthVersion['version_type']
    deps?: ModrinthDependency[]
    loaders?: string[]
    game?: string[]
  } = {}
): ModrinthVersion => ({
  id,
  project_id: projectId,
  version_number: `${id}-num`,
  version_type: opts.type ?? 'release',
  loaders: opts.loaders ?? ['fabric'],
  game_versions: opts.game ?? ['1.21.4'],
  dependencies: opts.deps ?? [],
  files: [
    {
      url: `https://cdn/${id}.jar`,
      filename: `${id}.jar`,
      primary: true,
      size: 1,
      hashes: { sha1: `s1-${id}`, sha512: `s5-${id}` }
    }
  ]
})

const req = (projectId: string | null, versionId: string | null = null): ModrinthDependency => ({
  project_id: projectId,
  version_id: versionId,
  file_name: null,
  dependency_type: 'required'
})

function ctx(
  projects: ModrinthProject[],
  versions: ModrinthVersion[],
  installed: string[] = []
): ResolveContext {
  const find = (idOrSlug: string) => {
    const p = projects.find((x) => x.id === idOrSlug || x.slug === idOrSlug)
    if (!p) throw new AppError('MODRINTH_API', 'not found', { status: 404 })
    return p
  }
  return {
    client: {
      project: vi.fn(async (id: string) => find(id)),
      version: vi.fn(async (id: string) => {
        const v = versions.find((x) => x.id === id)
        if (!v) throw new AppError('MODRINTH_API', 'not found', { status: 404 })
        return v
      }),
      versions: vi.fn(async (pid: string, loaders: string[], mc: string) =>
        versions.filter((v) => v.project_id === pid && isCompatible(v, loaders, mc))
      )
    },
    loaders: ['fabric'],
    mcVersion: '1.21.4',
    installedProjectIds: new Set(installed),
    targetLabel: 'Fabric 1.21.4'
  }
}

describe('pickVersion', () => {
  it('prefers the newest release, then beta, then alpha', () => {
    const a = version('a', 'p', { type: 'alpha' })
    const b = version('b', 'p', { type: 'beta' })
    const r1 = version('r1', 'p')
    const r2 = version('r2', 'p')
    expect(pickVersion([a, b, r1, r2])?.id).toBe('r1')
    expect(pickVersion([a, b])?.id).toBe('b')
    expect(pickVersion([a])?.id).toBe('a')
    expect(pickVersion([])).toBeNull()
  })
})

describe('isCompatible', () => {
  it('needs a shared loader and the game version', () => {
    expect(isCompatible(version('x', 'p'), ['fabric'], '1.21.4')).toBe(true)
    expect(isCompatible(version('x', 'p', { loaders: ['forge'] }), ['fabric'], '1.21.4')).toBe(
      false
    )
    expect(isCompatible(version('x', 'p', { game: ['1.21.1'] }), ['fabric'], '1.21.4')).toBe(false)
  })
})

describe('planInstall', () => {
  const SODIUM = project('AANobbMI', 'sodium', 'Sodium')
  const API = project('P7dR8mSH', 'fabric-api', 'Fabric API')
  const LIB = project('LIBLIBLI', 'some-lib', 'Some Lib')

  it('plans the project and its required dependency chain, root first', async () => {
    const c = ctx(
      [SODIUM, API, LIB],
      [
        version('s1', SODIUM.id, {
          deps: [req(API.id), { ...req(LIB.id), dependency_type: 'optional' }]
        }),
        version('a1', API.id, { deps: [req(LIB.id)] }),
        version('l1', LIB.id)
      ]
    )
    const plan = await planInstall('sodium', c)
    expect(plan.map((i) => [i.projectId, i.versionId, i.dependencyOf])).toEqual([
      [SODIUM.id, 's1', []],
      [API.id, 'a1', [SODIUM.id]],
      [LIB.id, 'l1', [API.id]]
    ])
    expect(plan[0]).toMatchObject({
      title: 'Sodium',
      versionNumber: 's1-num',
      file: {
        url: 'https://cdn/s1.jar',
        filename: 's1.jar',
        sha1: 's1-s1',
        sha512: 's5-s1',
        size: 1
      }
    })
  })

  it('handles dependency cycles and records every parent', async () => {
    const c = ctx(
      [SODIUM, API],
      [
        version('s1', SODIUM.id, { deps: [req(API.id)] }),
        version('a1', API.id, { deps: [req(SODIUM.id)] })
      ]
    )
    const plan = await planInstall(SODIUM.id, c)
    expect(plan.map((i) => i.projectId)).toEqual([SODIUM.id, API.id])
  })

  it('skips projects that are already installed', async () => {
    const c = ctx(
      [SODIUM, API],
      [version('s1', SODIUM.id, { deps: [req(API.id)] }), version('a1', API.id)],
      [API.id]
    )
    expect((await planInstall('sodium', c)).map((i) => i.projectId)).toEqual([SODIUM.id])
    const installedRoot = ctx([SODIUM], [version('s1', SODIUM.id)], [SODIUM.id])
    expect(await planInstall('sodium', installedRoot)).toEqual([])
  })

  it('uses a pinned dependency version when compatible, else the best compatible one', async () => {
    const pinnedOk = ctx(
      [SODIUM, API],
      [
        version('s1', SODIUM.id, { deps: [req(API.id, 'a-old')] }),
        version('a-old', API.id),
        version('a-new', API.id)
      ]
    )
    expect((await planInstall('sodium', pinnedOk))[1].versionId).toBe('a-old')

    const pinnedBad = ctx(
      [SODIUM, API],
      [
        version('s1', SODIUM.id, { deps: [req(API.id, 'a-forge')] }),
        version('a-forge', API.id, { loaders: ['forge'] }),
        version('a-new', API.id)
      ]
    )
    expect((await planInstall('sodium', pinnedBad))[1].versionId).toBe('a-new')

    const byVersionOnly = ctx(
      [SODIUM, API],
      [version('s1', SODIUM.id, { deps: [req(null, 'a1')] }), version('a1', API.id)]
    )
    expect((await planInstall('sodium', byVersionOnly))[1].projectId).toBe(API.id)
  })

  it('reports a project with no compatible version', async () => {
    const c = ctx([SODIUM], [version('s1', SODIUM.id, { game: ['1.20.1'] })])
    await expect(planInstall('sodium', c)).rejects.toMatchObject({
      code: 'CONTENT_NO_COMPATIBLE_VERSION',
      message: 'No version of Sodium supports Fabric 1.21.4.'
    })
  })

  it('reports an unavailable required dependency and plans nothing', async () => {
    const c = ctx([SODIUM, API], [version('s1', SODIUM.id, { deps: [req(API.id)] })])
    await expect(planInstall('sodium', c)).rejects.toMatchObject({
      code: 'CONTENT_DEPENDENCY_UNAVAILABLE',
      message: 'Sodium needs Fabric API, which has no version for Fabric 1.21.4.'
    })
  })

  it('reports a conflict with installed content', async () => {
    const c = ctx(
      [SODIUM, API],
      [version('s1', SODIUM.id, { deps: [{ ...req(API.id), dependency_type: 'incompatible' }] })],
      [API.id]
    )
    await expect(planInstall('sodium', c)).rejects.toMatchObject({
      code: 'CONTENT_CONFLICT',
      message: 'Sodium cannot be installed together with Fabric API.'
    })
  })

  it('prefers the requested version for the root (updates)', async () => {
    const c = ctx([SODIUM], [version('s2', SODIUM.id), version('s1', SODIUM.id)])
    expect((await planInstall('sodium', c, 's1'))[0].versionId).toBe('s1')
  })
})

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ServerStatus, ServerType } from '../../shared/types'
import { AppError } from '../errors'
import type { DownloadOptions } from '../net/download'
import { ServerStore } from '../servers/store'
import { manifestEntry, manifestOf, tempDir } from '../test-utils'
import { readManifest, writeManifest } from './manifest'
import type { ModrinthClient, ModrinthProject, ModrinthVersion } from './modrinth'
import { modrinthProvider } from './providers/modrinth'
import { ContentService, findOrphans, safeFileName } from './service'
import type { ContentProvider, Version } from './types'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SODIUM: ModrinthProject = {
  id: 'AANobbMI',
  slug: 'sodium',
  title: 'Sodium',
  icon_url: null,
  server_side: 'optional'
}
const hangarVersion = (id: string, projectId: string): Version => ({
  id,
  projectId,
  versionNumber: `${id}-num`,
  channel: 'release',
  publishedAt: null,
  mcVersions: ['1.21.4'],
  loaders: ['paper'],
  file: {
    url: `https://hangarcdn.papermc.io/${id}.jar`,
    externalUrl: null,
    filename: `${id}.jar`,
    size: 3,
    hash: { algo: 'sha256', value: `sha256-${id}` },
    sha1: null
  },
  dependencies: []
})

const API: ModrinthProject = {
  id: 'P7dR8mSH',
  slug: 'fabric-api',
  title: 'Fabric API',
  icon_url: null,
  server_side: 'optional'
}

function ver(
  id: string,
  projectId: string,
  filename: string,
  deps: string[] = []
): ModrinthVersion {
  return {
    id,
    project_id: projectId,
    version_number: `${id}-num`,
    version_type: 'release',
    loaders: ['fabric'],
    game_versions: ['1.21.4'],
    dependencies: deps.map((d) => ({
      project_id: d,
      version_id: null,
      file_name: null,
      dependency_type: 'required' as const
    })),
    files: [
      {
        url: `https://cdn.modrinth.com/data/${filename}`,
        filename,
        primary: true,
        size: 1,
        hashes: { sha1: `sha1-${id}`, sha512: `sha512-${id}` }
      }
    ]
  }
}

async function setup(
  opts: {
    type?: ServerType
    status?: ServerStatus
    fsOps?: { rename?: typeof rename; rm?: typeof rm }
    extraProvider?: boolean
    onUpdates?: (serverId: string, count: number) => void
  } = {}
) {
  const root = await tempDir()
  const store = new ServerStore(join(root, 'servers.json'))
  await store.load()
  const dir = join(root, 'srv')
  await mkdir(dir)
  await store.add({
    id: ID,
    name: 'SMP',
    type: opts.type ?? 'fabric',
    mcVersion: '1.21.4',
    dir,
    ramMb: 2048,
    port: 25565,
    jvmArgs: [],
    launch: { args: [] },
    installState: 'ready',
    createdAt: '2026-10-18T12:00:00.000Z'
  })
  const projects = [SODIUM, API]
  const versions: ModrinthVersion[] = [
    ver('s1', SODIUM.id, 'sodium-1.jar', [API.id]),
    ver('a1', API.id, 'fabric-api-1.jar')
  ]
  const find = (idOrSlug: string) => {
    const p = projects.find((x) => x.id === idOrSlug || x.slug === idOrSlug)
    if (!p) throw new AppError('CONTENT_SOURCE_API', 'not found', { status: 404 })
    return p
  }
  const client = {
    search: vi.fn(async () => ({
      hits: [
        {
          project_id: SODIUM.id,
          slug: 'sodium',
          title: 'Sodium',
          description: 'Fast',
          icon_url: 'https://cdn.modrinth.com/i.png',
          downloads: 9
        },
        {
          project_id: API.id,
          slug: 'fabric-api',
          title: 'Fabric API',
          description: 'API',
          icon_url: null,
          downloads: 8
        }
      ],
      total: 2
    })),
    project: vi.fn(async (id: string) => find(id)),
    projects: vi.fn(async (ids: string[]) => ids.map(find)),
    version: vi.fn(async (id: string) => versions.find((v) => v.id === id)!),
    versions: vi.fn(async (pid: string) => versions.filter((v) => v.project_id === pid)),
    allVersions: vi.fn(async (pid: string) => versions.filter((v) => v.project_id === pid)),
    identify: vi.fn(async (): Promise<Record<string, ModrinthVersion>> => ({})),
    latest: vi.fn(async (): Promise<Record<string, ModrinthVersion>> => ({}))
  } satisfies ModrinthClient
  const downloads: DownloadOptions[] = []
  const download = vi.fn(async (o: DownloadOptions) => {
    downloads.push(o)
    await mkdir(join(o.dest, '..'), { recursive: true })
    await writeFile(o.dest, 'jar')
  })
  const hashes: Record<string, string> = {}
  const processes = { status: vi.fn((): ServerStatus => opts.status ?? 'stopped') }
  const providersExtra = {
    versions: vi.fn(async (): Promise<Version[]> => [])
  }
  const extra: ContentProvider = {
    id: 'hangar',
    label: 'Hangar',
    supports: () => true,
    downloadHosts: ['hangarcdn.papermc.io'],
    categories: {},
    search: vi.fn(async () => ({ hits: [], total: 0 })),
    project: vi.fn(async (id: string) => ({
      id,
      slug: id,
      title: id,
      author: null,
      summary: '',
      iconUrl: null,
      downloads: 0,
      updatedAt: null,
      license: null,
      description: { format: 'markdown' as const, body: '' },
      gallery: [],
      links: [],
      pageUrl: ''
    })),
    versions: providersExtra.versions,
    allVersions: vi.fn(async () => [])
  }
  const service = new ContentService({
    store,
    processes,
    providers: opts.extraProvider ? [modrinthProvider(client), extra] : [modrinthProvider(client)],
    onUpdates: opts.onUpdates,
    download,
    hashFile: async (p) => hashes[basename(p)] ?? `unknown-${basename(p)}`,
    fsOps: opts.fsOps
  })
  const mods = join(dir, 'mods')
  return {
    store,
    dir,
    mods,
    client,
    versions,
    download,
    downloads,
    hashes,
    processes,
    service,
    providersExtra
  }
}

describe('safeFileName', () => {
  it('accepts plain jar names and rejects anything else', () => {
    expect(safeFileName('sodium-fabric-0.6.0+mc1.21.4.jar')).toBe(
      'sodium-fabric-0.6.0+mc1.21.4.jar'
    )
    for (const bad of [
      '../evil.jar',
      'a/b.jar',
      'a\\b.jar',
      'evil.exe',
      'x.jar ',
      'CON.jar',
      'a:b.jar',
      'a\u0000.jar',
      '',
      'x'.repeat(201) + '.jar',
      '..jar'
    ]) {
      expect(() => safeFileName(bad), bad).toThrowError(
        expect.objectContaining({ code: 'CONTENT_BAD_FILENAME' })
      )
    }
  })
})

describe('ContentService', () => {
  it('refuses servers without mods or plugins', async () => {
    const { service } = await setup({ type: 'vanilla' })
    await expect(service.search(ID, '', 0)).rejects.toMatchObject({ code: 'CONTENT_NOT_SUPPORTED' })
  })

  it('searches and marks installed projects', async () => {
    const { service, dir, client } = await setup()
    await writeManifest(
      dir,
      manifestOf([
        manifestEntry({
          fileName: 'fabric-api-1.jar',
          projectId: API.id,
          versionId: 'a1',
          title: 'Fabric API',
          versionNumber: '1',
          sha1: 'x',
          dependencyOf: []
        })
      ])
    )
    const r = await service.search(ID, 'sod', 20)
    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({ folder: 'mods' }),
      '1.21.4',
      'sod',
      20,
      { index: 'relevance', categories: undefined }
    )
    expect(r).toEqual({
      total: 2,
      hits: [
        {
          projectId: SODIUM.id,
          slug: 'sodium',
          title: 'Sodium',
          description: 'Fast',
          iconUrl: 'https://cdn.modrinth.com/i.png',
          downloads: 9,
          installed: false
        },
        {
          projectId: API.id,
          slug: 'fabric-api',
          title: 'Fabric API',
          description: 'API',
          iconUrl: null,
          downloads: 8,
          installed: true
        }
      ]
    })
  })

  it('installs a project with its dependency, verifying sha512', async () => {
    const { service, mods, dir, downloads } = await setup()
    const result = await service.install(ID, 'sodium')
    expect(result).toEqual({
      installed: [
        { title: 'Sodium', versionNumber: 's1-num', asDependency: false },
        { title: 'Fabric API', versionNumber: 'a1-num', asDependency: true }
      ],
      restartNeeded: false
    })
    // Dependencies are downloaded before the root item (fix round 1, issue 1), so this
    // differs from the brief's original order (root, then dependency).
    expect(downloads.map((d) => [basename(d.dest), d.hash])).toEqual([
      ['fabric-api-1.jar', { algo: 'sha512', value: 'sha512-a1' }],
      ['sodium-1.jar', { algo: 'sha512', value: 'sha512-s1' }]
    ])
    expect((await readdir(mods)).sort()).toEqual(['fabric-api-1.jar', 'sodium-1.jar'])
    expect((await readManifest(dir)).entries).toMatchObject([
      {
        fileName: 'sodium-1.jar',
        projectId: SODIUM.id,
        versionId: 's1',
        title: 'Sodium',
        versionNumber: 's1-num',
        sha1: 'sha1-s1',
        dependencyOf: []
      },
      {
        fileName: 'fabric-api-1.jar',
        projectId: API.id,
        versionId: 'a1',
        title: 'Fabric API',
        versionNumber: 'a1-num',
        sha1: 'sha1-a1',
        dependencyOf: [`modrinth:${SODIUM.id}`]
      }
    ])
  })

  it('reports that a restart is needed while the server runs', async () => {
    const { service } = await setup({ status: 'running' })
    expect((await service.install(ID, 'sodium')).restartNeeded).toBe(true)
  })

  it('removes files it wrote when a later download fails', async () => {
    const { service, mods, dir, download } = await setup()
    download.mockImplementationOnce(async (o: DownloadOptions) => {
      await mkdir(mods, { recursive: true })
      await writeFile(o.dest, 'jar')
    })
    download.mockRejectedValueOnce(
      new AppError('HASH_MISMATCH', 'Checksum mismatch for fabric-api-1.jar')
    )
    await expect(service.install(ID, 'sodium')).rejects.toMatchObject({ code: 'HASH_MISMATCH' })
    expect(await readdir(mods)).toEqual([])
    expect((await readManifest(dir)).entries).toEqual([])
  })

  it('skips a download when a file with that name exists', async () => {
    const { service, mods, download } = await setup()
    await mkdir(mods)
    await writeFile(join(mods, 'fabric-api-1.jar'), 'mine')
    await service.install(ID, 'sodium')
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('rejects unsafe file names from Modrinth before writing anything', async () => {
    const { service, versions, download } = await setup()
    versions[0].files[0].filename = '..\\..\\evil.jar'
    await expect(service.install(ID, 'sodium')).rejects.toMatchObject({
      code: 'CONTENT_BAD_FILENAME'
    })
    expect(download).not.toHaveBeenCalled()
  })

  it('lists installed jars, identifies manual ones and finds updates', async () => {
    const { service, mods, dir, client, hashes } = await setup()
    await mkdir(mods)
    for (const f of ['sodium-1.jar', 'mystery.jar', 'api-by-hand.jar', 'notes.txt'])
      await writeFile(join(mods, f), 'x')
    hashes['sodium-1.jar'] = 'sha1-s1'
    hashes['api-by-hand.jar'] = 'sha1-a1'
    await writeManifest(
      dir,
      manifestOf([
        manifestEntry({
          fileName: 'sodium-1.jar',
          projectId: SODIUM.id,
          versionId: 's1',
          title: 'Sodium',
          versionNumber: 's1-num',
          sha1: 'sha1-s1',
          dependencyOf: []
        }),
        manifestEntry({
          fileName: 'gone.jar',
          projectId: 'GONEGONE',
          versionId: 'g',
          title: 'Gone',
          versionNumber: 'g',
          sha1: 'g',
          dependencyOf: []
        })
      ])
    )
    client.identify.mockResolvedValueOnce({ 'sha1-a1': ver('a1', API.id, 'fabric-api-1.jar') })
    client.latest.mockResolvedValueOnce({ 'sha1-s1': ver('s2', SODIUM.id, 'sodium-2.jar') })

    const list = await service.listInstalled(ID)
    expect(client.identify).toHaveBeenCalledWith(['sha1-a1', 'unknown-mystery.jar'])
    expect(list.offline).toEqual([])
    expect(list.items).toMatchObject([
      {
        fileName: 'api-by-hand.jar',
        title: 'Fabric API',
        versionNumber: 'a1-num',
        source: 'modrinth',
        projectId: API.id,
        neededBy: []
      },
      {
        fileName: 'mystery.jar',
        title: 'mystery.jar',
        versionNumber: null,
        source: 'manual',
        neededBy: []
      },
      {
        fileName: 'sodium-1.jar',
        title: 'Sodium',
        versionNumber: 's1-num',
        source: 'modrinth',
        projectId: SODIUM.id,
        update: { versionId: 's2', versionNumber: 's2-num' },
        neededBy: []
      }
    ])
    expect((await readManifest(dir)).entries.map((e) => e.fileName).sort()).toEqual([
      'api-by-hand.jar',
      'sodium-1.jar'
    ])
  })

  it('names the content that needs a dependency', async () => {
    const { service, mods, hashes } = await setup()
    await service.install(ID, 'sodium')
    hashes['sodium-1.jar'] = 'sha1-s1'
    hashes['fabric-api-1.jar'] = 'sha1-a1'
    const list = await service.listInstalled(ID)
    expect(list.items.find((i) => i.fileName === 'fabric-api-1.jar')?.neededBy).toEqual(['Sodium'])
    expect(await readdir(mods)).toHaveLength(2)
  })

  it('still lists local files when Modrinth is unreachable', async () => {
    const { service, mods, client } = await setup()
    await mkdir(mods)
    await writeFile(join(mods, 'mystery.jar'), 'x')
    client.identify.mockRejectedValueOnce(new AppError('NETWORK', 'Could not reach Modrinth'))
    const list = await service.listInstalled(ID)
    expect(list).toMatchObject({
      offline: ['modrinth'],
      items: [
        {
          fileName: 'mystery.jar',
          title: 'mystery.jar',
          versionNumber: null,
          source: 'manual',
          neededBy: []
        }
      ]
    })
  })

  it('refuses update and remove while the server is running', async () => {
    for (const status of ['starting', 'running', 'stopping'] as const) {
      const { service } = await setup({ status })
      await expect(service.remove(ID, 'sodium-1.jar')).rejects.toMatchObject({
        code: 'SERVER_RUNNING'
      })
      await expect(service.update(ID, 'sodium-1.jar')).rejects.toMatchObject({
        code: 'SERVER_RUNNING'
      })
    }
  })

  it('updates by downloading the new version and removing the old file', async () => {
    const { service, mods, dir, client, versions, hashes } = await setup()
    await service.install(ID, 'sodium')
    hashes['sodium-1.jar'] = 'sha1-s1'
    versions.unshift(ver('s2', SODIUM.id, 'sodium-2.jar', [API.id]))
    client.latest.mockResolvedValueOnce({ 'sha1-s1': versions[0] })
    const result = await service.update(ID, 'sodium-1.jar')
    expect(result.installed).toEqual([
      { title: 'Sodium', versionNumber: 's2-num', asDependency: false }
    ])
    expect((await readdir(mods)).sort()).toEqual(['fabric-api-1.jar', 'sodium-2.jar'])
    const entries = (await readManifest(dir)).entries
    expect(entries.find((e) => e.projectId === SODIUM.id)).toMatchObject({
      fileName: 'sodium-2.jar',
      versionId: 's2'
    })
    expect(entries).toHaveLength(2)
  })

  it('does nothing when no update is available', async () => {
    const { service, download } = await setup()
    await service.install(ID, 'sodium')
    download.mockClear()
    expect(await service.update(ID, 'sodium-1.jar')).toEqual({
      installed: [],
      restartNeeded: false
    })
    expect(download).not.toHaveBeenCalled()
  })

  it('removes a file and its manifest entry', async () => {
    const { service, mods, dir } = await setup()
    await service.install(ID, 'sodium')
    await service.remove(ID, 'sodium-1.jar')
    expect(await readdir(mods)).toEqual(['fabric-api-1.jar'])
    expect((await readManifest(dir)).entries.map((e) => e.fileName)).toEqual(['fabric-api-1.jar'])
    await expect(service.remove(ID, '../x.jar')).rejects.toMatchObject({
      code: 'CONTENT_BAD_FILENAME'
    })
  })
})

describe('ContentService update safety (fix round 1)', () => {
  it("keeps the old jar and manifest when a same-name update's dependency download fails", async () => {
    const { service, mods, dir, client, versions, hashes, download } = await setup()
    await service.install(ID, 'sodium')
    hashes['sodium-1.jar'] = 'sha1-s1'
    const before = await readFile(join(mods, 'sodium-1.jar'), 'utf8')

    const NEW_DEP: ModrinthProject = {
      id: 'NEWDEP01',
      slug: 'newdep',
      title: 'NewDep',
      icon_url: null,
      server_side: 'optional'
    }
    const newDepVersion = ver('nd1', NEW_DEP.id, 'newdep-1.jar')
    versions.push(newDepVersion)
    const s2 = ver('s2', SODIUM.id, 'sodium-1.jar', [API.id, NEW_DEP.id])
    versions.push(s2)
    client.project.mockImplementation(async (id: string) => {
      if (id === NEW_DEP.id) return NEW_DEP
      if (id === SODIUM.id || id === 'sodium') return SODIUM
      if (id === API.id || id === 'fabric-api') return API
      throw new AppError('CONTENT_SOURCE_API', 'not found', { status: 404 })
    })
    client.latest.mockResolvedValueOnce({ 'sha1-s1': s2 })
    // Fails specifically for the new dependency's file, regardless of call order, so this
    // test proves the fix rather than depending on which item an implementation downloads first.
    download.mockImplementation(async (o: DownloadOptions) => {
      if (basename(o.dest).includes('newdep'))
        throw new AppError('NETWORK', 'Could not reach Modrinth')
      await writeFile(o.dest, 'new-sodium-content')
    })

    await expect(service.update(ID, 'sodium-1.jar')).rejects.toMatchObject({ code: 'NETWORK' })
    expect(await readFile(join(mods, 'sodium-1.jar'), 'utf8')).toBe(before)
    expect((await readManifest(dir)).entries.find((e) => e.projectId === SODIUM.id)).toMatchObject({
      fileName: 'sodium-1.jar',
      versionId: 's1'
    })
    expect((await readdir(mods)).sort()).toEqual(['fabric-api-1.jar', 'sodium-1.jar'])
  })

  it('replaces the file in place for a same-name update once every download succeeds', async () => {
    const { service, mods, dir, client, versions, hashes, download } = await setup()
    await service.install(ID, 'sodium')
    hashes['sodium-1.jar'] = 'sha1-s1'
    const s2 = ver('s2', SODIUM.id, 'sodium-1.jar', [API.id])
    versions.push(s2)
    client.latest.mockResolvedValueOnce({ 'sha1-s1': s2 })
    download.mockImplementationOnce(async (o: DownloadOptions) => {
      await writeFile(o.dest, 'new-content')
    })

    const result = await service.update(ID, 'sodium-1.jar')
    expect(result.installed).toEqual([
      { title: 'Sodium', versionNumber: 's2-num', asDependency: false }
    ])
    expect((await readdir(mods)).sort()).toEqual(['fabric-api-1.jar', 'sodium-1.jar'])
    expect(await readFile(join(mods, 'sodium-1.jar'), 'utf8')).toBe('new-content')
    const entry = (await readManifest(dir)).entries.find((e) => e.projectId === SODIUM.id)
    expect(entry).toMatchObject({ fileName: 'sodium-1.jar', versionId: 's2' })
  })

  it('updates the matching entry only when a project has duplicate manifest entries', async () => {
    const { service, mods, dir, client, versions, hashes } = await setup()
    await service.install(ID, 'sodium')
    hashes['sodium-1.jar'] = 'sha1-s1'
    await writeFile(join(mods, 'sodium-copy.jar'), 'copy')
    const manifest = await readManifest(dir)
    const sodiumEntry = manifest.entries.find((e) => e.projectId === SODIUM.id)!
    await writeManifest(
      dir,
      manifestOf([
        ...manifest.entries,
        { ...sodiumEntry, fileName: 'sodium-copy.jar', sha1: 'copy-sha' }
      ])
    )

    const s2 = ver('s2', SODIUM.id, 'sodium-2.jar', [API.id])
    versions.push(s2)
    client.latest.mockResolvedValueOnce({ 'sha1-s1': s2 })

    const result = await service.update(ID, 'sodium-1.jar')
    expect(result.installed).toEqual([
      { title: 'Sodium', versionNumber: 's2-num', asDependency: false }
    ])
    expect((await readdir(mods)).sort()).toEqual([
      'fabric-api-1.jar',
      'sodium-2.jar',
      'sodium-copy.jar'
    ])
    expect(await readFile(join(mods, 'sodium-copy.jar'), 'utf8')).toBe('copy')
    const entries = (await readManifest(dir)).entries
    expect(entries).toHaveLength(3)
    expect(entries.find((e) => e.fileName === 'sodium-copy.jar')).toBeDefined()
    expect(entries.find((e) => e.fileName === 'sodium-2.jar')).toMatchObject({ versionId: 's2' })
    expect(entries.find((e) => e.fileName === 'sodium-1.jar')).toBeUndefined()
  })

  it('does not report a restart needed when nothing was actually written', async () => {
    const { service, mods } = await setup({ status: 'running' })
    await mkdir(mods, { recursive: true })
    await writeFile(join(mods, 'sodium-1.jar'), 'preexisting')
    await writeFile(join(mods, 'fabric-api-1.jar'), 'preexisting')
    const result = await service.install(ID, 'sodium')
    expect(result.restartNeeded).toBe(false)
  })

  it('ignores non-file entries in the content folder', async () => {
    const { service, mods } = await setup()
    await mkdir(mods, { recursive: true })
    await mkdir(join(mods, 'weird.jar'))
    await writeFile(join(mods, 'real.jar'), 'x')
    const list = await service.listInstalled(ID)
    expect(list.items.map((i) => i.fileName)).toEqual(['real.jar'])
  })

  it('rejects an update if the server starts while downloads are in flight, leaving the old jar untouched', async () => {
    const { service, mods, dir, client, versions, hashes, processes } = await setup()
    await service.install(ID, 'sodium')
    hashes['sodium-1.jar'] = 'sha1-s1'
    const s2 = ver('s2', SODIUM.id, 'sodium-2.jar', [API.id])
    versions.push(s2)
    client.latest.mockResolvedValueOnce({ 'sha1-s1': s2 })
    processes.status.mockImplementationOnce(() => 'stopped').mockImplementation(() => 'running')
    const before = await readFile(join(mods, 'sodium-1.jar'), 'utf8')

    await expect(service.update(ID, 'sodium-1.jar')).rejects.toMatchObject({
      code: 'SERVER_RUNNING'
    })
    expect(await readFile(join(mods, 'sodium-1.jar'), 'utf8')).toBe(before)
    expect((await readdir(mods)).sort()).toEqual(['fabric-api-1.jar', 'sodium-1.jar'])
    expect((await readManifest(dir)).entries.find((e) => e.projectId === SODIUM.id)).toMatchObject({
      fileName: 'sodium-1.jar',
      versionId: 's1'
    })
  })
})

describe('ContentService final review fixes', () => {
  it('records every installed mod that needs a shared dependency', async () => {
    const { service, client, versions, hashes } = await setup()
    const LITH: ModrinthProject = {
      id: 'LITHLITH',
      slug: 'lithium',
      title: 'Lithium',
      icon_url: null,
      server_side: 'optional'
    }
    versions.push(ver('l1', LITH.id, 'lithium-1.jar', [API.id]))
    const original = client.project.getMockImplementation()!
    client.project.mockImplementation(async (id: string) =>
      id === LITH.id || id === 'lithium' ? LITH : original(id)
    )
    await service.install(ID, 'sodium')
    await service.install(ID, 'lithium')
    hashes['sodium-1.jar'] = 'sha1-s1'
    hashes['fabric-api-1.jar'] = 'sha1-a1'
    hashes['lithium-1.jar'] = 'sha1-l1'
    const list = await service.listInstalled(ID)
    expect(list.items.find((i) => i.fileName === 'fabric-api-1.jar')?.neededBy).toEqual([
      'Sodium',
      'Lithium'
    ])
  })

  it('does not make a search wait for a pending install', async () => {
    const { service, download } = await setup()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    download.mockImplementation(async (o: DownloadOptions) => {
      await gate
      await mkdir(join(o.dest, '..'), { recursive: true })
      await writeFile(o.dest, 'jar')
    })
    const install = service.install(ID, 'sodium')
    await vi.waitFor(() => expect(download).toHaveBeenCalled())
    const r = await Promise.race([
      service.search(ID, 'sod', 0).then(() => 'searched'),
      new Promise((r) => setTimeout(() => r('blocked'), 500))
    ])
    expect(r).toBe('searched')
    release()
    await install
  })

  /** Installs Sodium as `oldName`, then offers an update whose file is `newName`. */
  async function updateFixture(
    oldName: string,
    newName: string,
    opts: Parameters<typeof setup>[0] = {},
    extraDeps: string[] = []
  ) {
    const t = await setup(opts)
    t.versions[0].files[0].filename = oldName
    await t.service.install(ID, 'sodium')
    t.hashes[oldName] = 'sha1-s1'
    const s2 = ver('s2', SODIUM.id, newName, [API.id, ...extraDeps])
    t.versions.push(s2)
    t.client.latest.mockResolvedValueOnce({ 'sha1-s1': s2 })
    t.download.mockImplementation(async (o: DownloadOptions) => {
      await writeFile(o.dest, `new:${basename(o.dest)}`)
    })
    return t
  }

  it('keeps the new jar when an update only changes the file name case', async () => {
    const { service, mods, dir } = await updateFixture('Sodium-1.jar', 'sodium-1.jar')
    await service.update(ID, 'Sodium-1.jar')
    const files = await readdir(mods)
    expect(files.sort()).toEqual(['fabric-api-1.jar', 'sodium-1.jar'])
    expect(await readFile(join(mods, 'sodium-1.jar'), 'utf8')).toBe(
      'new:sodium-1.jar.blockhost-update'
    )
    const entry = (await readManifest(dir)).entries.find((e) => e.projectId === SODIUM.id)
    expect(entry).toMatchObject({ fileName: 'sodium-1.jar', versionId: 's2' })
    expect(files).toContain(entry!.fileName)
  })

  it('leaves the original jar intact when a case-only update fails its re-check', async () => {
    const { service, mods, dir, processes } = await updateFixture('Sodium-1.jar', 'sodium-1.jar')
    processes.status.mockImplementationOnce(() => 'stopped').mockImplementation(() => 'running')
    await expect(service.update(ID, 'Sodium-1.jar')).rejects.toMatchObject({
      code: 'SERVER_RUNNING'
    })
    expect((await readdir(mods)).sort()).toEqual(['Sodium-1.jar', 'fabric-api-1.jar'])
    expect(await readFile(join(mods, 'Sodium-1.jar'), 'utf8')).toBe('jar')
    expect((await readManifest(dir)).entries.find((e) => e.projectId === SODIUM.id)).toMatchObject({
      fileName: 'Sodium-1.jar',
      versionId: 's1'
    })
  })

  it('never deletes an existing file that a failed update would have replaced', async () => {
    const { service, mods, processes } = await updateFixture('sodium-1.jar', 'sodium-2.jar')
    await writeFile(join(mods, 'Sodium-2.jar'), 'manual')
    processes.status.mockImplementationOnce(() => 'stopped').mockImplementation(() => 'running')
    await expect(service.update(ID, 'sodium-1.jar')).rejects.toMatchObject({
      code: 'SERVER_RUNNING'
    })
    expect((await readdir(mods)).sort()).toEqual([
      'Sodium-2.jar',
      'fabric-api-1.jar',
      'sodium-1.jar'
    ])
    expect(await readFile(join(mods, 'Sodium-2.jar'), 'utf8')).toBe('manual')
  })

  it('keeps rolling back when one file cannot be removed, and reports the original error', async () => {
    const NEW_DEP: ModrinthProject = {
      id: 'NEWDEP01',
      slug: 'newdep',
      title: 'NewDep',
      icon_url: null,
      server_side: 'optional'
    }
    const failingRm = vi.fn(
      async (path: Parameters<typeof rm>[0], o?: Parameters<typeof rm>[1]) => {
        if (String(path).includes('newdep')) throw new Error('EBUSY: resource busy or locked')
        return rm(path, o)
      }
    )
    const { service, mods, client, versions, processes } = await updateFixture(
      'sodium-1.jar',
      'sodium-2.jar',
      { fsOps: { rm: failingRm } },
      [NEW_DEP.id]
    )
    versions.push(ver('nd1', NEW_DEP.id, 'newdep-1.jar'))
    const original = client.project.getMockImplementation()!
    client.project.mockImplementation(async (id: string) =>
      id === NEW_DEP.id ? NEW_DEP : original(id)
    )
    processes.status.mockImplementationOnce(() => 'stopped').mockImplementation(() => 'running')
    await expect(service.update(ID, 'sodium-1.jar')).rejects.toMatchObject({
      code: 'SERVER_RUNNING'
    })
    expect(failingRm).toHaveBeenCalledTimes(2)
    expect((await readdir(mods)).sort()).toEqual([
      'fabric-api-1.jar',
      'newdep-1.jar',
      'sodium-1.jar'
    ])
  })

  it('reports a failed replace and leaves the old jar in place', async () => {
    const failingRename = vi.fn(async () => {
      throw new Error('EPERM: operation not permitted')
    })
    const { service, mods, dir } = await updateFixture('sodium-1.jar', 'sodium-2.jar', {
      fsOps: { rename: failingRename }
    })
    await expect(service.update(ID, 'sodium-1.jar')).rejects.toMatchObject({
      code: 'CONTENT_IO',
      message: 'Could not replace sodium-2.jar: EPERM: operation not permitted. Try again.'
    })
    expect((await readdir(mods)).sort()).toEqual(['fabric-api-1.jar', 'sodium-1.jar'])
    expect(await readFile(join(mods, 'sodium-1.jar'), 'utf8')).toBe('jar')
    expect((await readManifest(dir)).entries.find((e) => e.projectId === SODIUM.id)).toMatchObject({
      fileName: 'sodium-1.jar',
      versionId: 's1'
    })
  })

  it('records the update but asks for a manual delete when the old jar cannot be removed', async () => {
    const failingRm = vi.fn(async () => {
      throw new Error('EBUSY: resource busy or locked')
    })
    const { service, mods, dir } = await updateFixture('sodium-1.jar', 'sodium-2.jar', {
      fsOps: { rm: failingRm }
    })
    await expect(service.update(ID, 'sodium-1.jar')).rejects.toMatchObject({
      code: 'CONTENT_IO',
      message:
        'Updated Sodium, but could not remove the old file sodium-1.jar. Delete it by hand before starting the server.'
    })
    expect((await readdir(mods)).sort()).toEqual([
      'fabric-api-1.jar',
      'sodium-1.jar',
      'sodium-2.jar'
    ])
    const entries = (await readManifest(dir)).entries
    expect(entries.find((e) => e.projectId === SODIUM.id)).toMatchObject({
      fileName: 'sodium-2.jar',
      versionId: 's2'
    })
    expect(entries.find((e) => e.fileName === 'sodium-1.jar')).toBeUndefined()
  })

  it('refuses download links outside the Modrinth CDN before writing anything', async () => {
    for (const url of [
      'http://cdn.modrinth.com/data/x.jar',
      'https://evil.example/x.jar',
      'not a url'
    ]) {
      const { service, versions, download } = await setup()
      versions[1].files[0].url = url
      await expect(service.install(ID, 'sodium')).rejects.toMatchObject({
        code: 'CONTENT_SOURCE_API',
        message: 'Unexpected download location for fabric-api-1.jar'
      })
      expect(download).not.toHaveBeenCalled()
    }
  })
})

describe('ContentService providers and v2 manifest', () => {
  it('restricts downloads to the provider hosts and records explicit installs', async () => {
    const { service, dir, downloads } = await setup()
    await service.install(ID, 'sodium')
    expect(downloads.every((d) => d.allowedHosts?.join() === 'cdn.modrinth.com')).toBe(true)
    const entries = (await readManifest(dir)).entries
    expect(entries.map((e) => [e.fileName, e.explicit, e.source])).toEqual([
      ['sodium-1.jar', true, 'modrinth'],
      ['fabric-api-1.jar', false, 'modrinth']
    ])
  })

  it('keeps explicit and installedAt on update', async () => {
    const { service, dir, mods, versions, client, hashes } = await setup()
    await service.install(ID, 'sodium')
    hashes['sodium-1.jar'] = 'sha1-s1'
    const before = (await readManifest(dir)).entries.find((e) => e.projectId === SODIUM.id)!
    versions.push(ver('s2', SODIUM.id, 'sodium-2.jar', [API.id]))
    client.latest.mockResolvedValueOnce({ 'sha1-s1': versions.at(-1)! })
    await service.update(ID, 'sodium-1.jar')
    const after = (await readManifest(dir)).entries.find((e) => e.projectId === SODIUM.id)!
    expect(after).toMatchObject({
      fileName: 'sodium-2.jar',
      versionId: 's2',
      explicit: before.explicit,
      installedAt: before.installedAt
    })
    expect((await readdir(mods)).sort()).toEqual(['fabric-api-1.jar', 'sodium-2.jar'])
  })

  it('fills in an empty stored sha1 from the file on disk', async () => {
    const { service, dir, mods, hashes } = await setup()
    await mkdir(mods)
    await writeFile(join(mods, 'sodium-1.jar'), 'x')
    hashes['sodium-1.jar'] = 'computed'
    await writeManifest(
      dir,
      manifestOf([manifestEntry({ fileName: 'sodium-1.jar', projectId: SODIUM.id, sha1: '' })])
    )
    await service.listInstalled(ID)
    expect((await readManifest(dir)).entries[0].sha1).toBe('computed')
  })
})

describe('ContentService sha1 handling (fix round 1)', () => {
  it('drops an entry with an empty sha1 whose jar is gone', async () => {
    const { service, dir, mods } = await setup()
    await mkdir(mods)
    await writeManifest(
      dir,
      manifestOf([manifestEntry({ fileName: 'gone.jar', projectId: 'GONE', sha1: '' })])
    )
    await service.listInstalled(ID)
    expect((await readManifest(dir)).entries).toEqual([])
  })

  it('records the on-disk hash when the source gives no sha1', async () => {
    const { service, dir, versions, hashes } = await setup()
    versions[0].files[0].hashes.sha1 = undefined as unknown as string
    hashes['sodium-1.jar'] = 'disk-hash'
    hashes['fabric-api-1.jar'] = 'api-disk'
    await service.install(ID, 'sodium')
    const sha = Object.fromEntries(
      (await readManifest(dir)).entries.map((e) => [e.fileName, e.sha1])
    )
    expect(sha).toEqual({ 'sodium-1.jar': 'disk-hash', 'fabric-api-1.jar': 'sha1-a1' })
  })
})

describe('ContentService installed list v2', () => {
  it('lists disabled jars under their enabled name', async () => {
    const { service, mods, dir, hashes } = await setup()
    await mkdir(mods)
    await writeFile(join(mods, 'sodium-1.jar.disabled'), 'x')
    hashes['sodium-1.jar.disabled'] = 'sha1-s1'
    await writeManifest(
      dir,
      manifestOf([
        manifestEntry({
          fileName: 'sodium-1.jar',
          projectId: SODIUM.id,
          sha1: 'sha1-s1',
          disabled: true
        })
      ])
    )
    const list = await service.listInstalled(ID)
    expect(list.items).toMatchObject([
      { fileName: 'sodium-1.jar', disabled: true, source: 'modrinth' }
    ])
  })

  it('disables and enables by renaming, refusing while running or on a name clash', async () => {
    const { service, mods, dir, processes } = await setup()
    await mkdir(mods)
    await writeFile(join(mods, 'sodium-1.jar'), 'x')
    await writeManifest(
      dir,
      manifestOf([manifestEntry({ fileName: 'sodium-1.jar', projectId: SODIUM.id })])
    )
    await service.setEnabled(ID, 'sodium-1.jar', false)
    expect(await readdir(mods)).toEqual(['sodium-1.jar.disabled'])
    expect((await readManifest(dir)).entries[0].disabled).toBe(true)
    await writeFile(join(mods, 'sodium-1.jar'), 'other')
    await expect(service.setEnabled(ID, 'sodium-1.jar', true)).rejects.toMatchObject({
      code: 'CONTENT_FILE_EXISTS'
    })
    processes.status.mockReturnValue('running')
    await expect(service.setEnabled(ID, 'sodium-1.jar', true)).rejects.toMatchObject({
      code: 'SERVER_RUNNING'
    })
  })

  it('disables a manual jar too', async () => {
    const { service, mods } = await setup()
    await mkdir(mods)
    await writeFile(join(mods, 'hand.jar'), 'x')
    await service.setEnabled(ID, 'hand.jar', false)
    expect(await readdir(mods)).toEqual(['hand.jar.disabled'])
    expect((await service.listInstalled(ID)).items).toMatchObject([
      { fileName: 'hand.jar', source: 'manual', disabled: true }
    ])
  })

  it('stores includeBeta and uses it for update checks', async () => {
    const { service, client, dir, mods, hashes } = await setup()
    await mkdir(mods)
    await writeFile(join(mods, 'sodium-1.jar'), 'x')
    hashes['sodium-1.jar'] = 'sha1-s1'
    await writeManifest(
      dir,
      manifestOf([
        manifestEntry({ fileName: 'sodium-1.jar', projectId: SODIUM.id, sha1: 'sha1-s1' })
      ])
    )
    await service.setIncludeBeta(ID, true)
    expect((await readManifest(dir)).includeBeta).toBe(true)
    const list = await service.listInstalled(ID)
    expect(list.includeBeta).toBe(true)
    expect(client.latest).toHaveBeenLastCalledWith(['sha1-s1'], ['fabric'], '1.21.4', true)
  })

  it('checks sources without a fast path project by project and reports which were offline', async () => {
    const { service, dir, mods, hashes, providersExtra } = await setup({ extraProvider: true })
    await mkdir(mods)
    await writeFile(join(mods, 'h.jar'), 'x')
    hashes['h.jar'] = 'sha1-h'
    await writeManifest(
      dir,
      manifestOf([
        manifestEntry({
          fileName: 'h.jar',
          projectId: 'H',
          source: 'hangar',
          sha1: 'sha1-h',
          versionId: 'old'
        })
      ])
    )
    providersExtra.versions.mockResolvedValueOnce([hangarVersion('new', 'H')])
    let list = await service.listInstalled(ID)
    expect(list.items[0].update).toEqual({ versionId: 'new', versionNumber: 'new-num' })
    providersExtra.versions.mockRejectedValueOnce(new AppError('NETWORK', 'down'))
    list = await service.listInstalled(ID)
    expect(list.offline).toEqual(['hangar'])
  })

  it('reports the update count', async () => {
    const onUpdates = vi.fn()
    const { service } = await setup({ onUpdates })
    await service.listInstalled(ID)
    expect(onUpdates).toHaveBeenCalledWith(ID, 0)
  })

  it('updates a disabled jar and keeps it disabled', async () => {
    const { service, mods, dir, client, versions, hashes } = await setup()
    await service.install(ID, 'sodium')
    hashes['sodium-1.jar'] = 'sha1-s1'
    await service.setEnabled(ID, 'sodium-1.jar', false)
    const s2 = ver('s2', SODIUM.id, 'sodium-2.jar', [API.id])
    versions.push(s2)
    client.latest.mockResolvedValueOnce({ 'sha1-s1': s2 })
    await service.update(ID, 'sodium-1.jar')
    expect((await readdir(mods)).sort()).toEqual(['fabric-api-1.jar', 'sodium-2.jar.disabled'])
    expect((await readManifest(dir)).entries.find((e) => e.projectId === SODIUM.id)).toMatchObject({
      fileName: 'sodium-2.jar',
      disabled: true
    })
  })

  it('keeps a disabled jar disabled when its update only half succeeds', async () => {
    const failingRm = vi.fn(async () => {
      throw new Error('EBUSY: resource busy or locked')
    })
    const { service, mods, dir, client, versions, hashes } = await setup({
      fsOps: { rm: failingRm }
    })
    await service.install(ID, 'sodium')
    hashes['sodium-1.jar'] = 'sha1-s1'
    await service.setEnabled(ID, 'sodium-1.jar', false)
    const s2 = ver('s2', SODIUM.id, 'sodium-2.jar', [API.id])
    versions.push(s2)
    client.latest.mockResolvedValueOnce({ 'sha1-s1': s2 })
    await expect(service.update(ID, 'sodium-1.jar')).rejects.toMatchObject({ code: 'CONTENT_IO' })
    expect((await readdir(mods)).sort()).toEqual([
      'fabric-api-1.jar',
      'sodium-1.jar.disabled',
      'sodium-2.jar.disabled'
    ])
    expect((await readManifest(dir)).entries.find((e) => e.projectId === SODIUM.id)).toMatchObject({
      fileName: 'sodium-2.jar',
      disabled: true
    })
  })

  it('removes both the jar and its disabled form', async () => {
    const { service, mods } = await setup()
    await mkdir(mods)
    await writeFile(join(mods, 'a.jar.disabled'), 'x')
    await service.remove(ID, 'a.jar')
    expect(await readdir(mods)).toEqual([])
  })
})

describe('findOrphans', () => {
  it('follows dependency chains and keeps explicit or shared entries', () => {
    const a = manifestEntry({ fileName: 'a.jar', projectId: 'A' })
    const b = manifestEntry({
      fileName: 'b.jar',
      projectId: 'B',
      explicit: false,
      dependencyOf: ['modrinth:A']
    })
    const c = manifestEntry({
      fileName: 'c.jar',
      projectId: 'C',
      explicit: false,
      dependencyOf: ['modrinth:B']
    })
    const d = manifestEntry({
      fileName: 'd.jar',
      projectId: 'D',
      explicit: false,
      dependencyOf: ['modrinth:A', 'modrinth:E']
    })
    const e = manifestEntry({ fileName: 'e.jar', projectId: 'E' })
    const f = manifestEntry({
      fileName: 'f.jar',
      projectId: 'F',
      explicit: true,
      dependencyOf: ['modrinth:A']
    })
    expect(findOrphans([a, b, c, d, e, f], 'modrinth:A').map((x) => x.fileName)).toEqual([
      'b.jar',
      'c.jar'
    ])
  })
})

describe('ContentService bulk actions', () => {
  it('removes orphaned dependencies when asked', async () => {
    const { service, mods } = await setup()
    await service.install(ID, 'sodium') // installs sodium + fabric api (dependency)
    expect(await service.orphansOf(ID, 'sodium-1.jar')).toEqual([
      { fileName: 'fabric-api-1.jar', title: 'Fabric API' }
    ])
    await service.remove(ID, 'sodium-1.jar', { removeOrphans: true })
    expect(await readdir(mods)).toEqual([])
  })

  it('keeps dependencies by default', async () => {
    const { service, mods } = await setup()
    await service.install(ID, 'sodium')
    await service.remove(ID, 'sodium-1.jar')
    expect(await readdir(mods)).toEqual(['fabric-api-1.jar'])
  })

  it('updates everything it can and reports failures', async () => {
    const { service, client, versions, mods, hashes, dir, download } = await setup()
    await service.install(ID, 'sodium')
    hashes['sodium-1.jar'] = 'sha1-s1'
    hashes['fabric-api-1.jar'] = 'sha1-a1'
    const s2 = ver('s2', SODIUM.id, 'sodium-2.jar', [API.id])
    const a2 = ver('a2', API.id, 'fabric-api-2.jar')
    versions.push(s2, a2)
    client.latest.mockResolvedValue({ 'sha1-s1': s2, 'sha1-a1': a2 })
    // Fabric API's download fails; Sodium's succeeds.
    const original = download.getMockImplementation()!
    download.mockImplementation(async (o: DownloadOptions) => {
      if (o.url.endsWith('fabric-api-2.jar')) throw new AppError('HASH_MISMATCH', 'bad')
      return original(o)
    })
    const r = await service.updateAll(ID)
    expect(r.updated).toEqual([{ title: 'Sodium', from: 's1-num', to: 's2-num' }])
    expect(r.failed).toMatchObject([{ title: 'Fabric API' }])
    expect((await readdir(mods)).sort()).toContain('sodium-2.jar')
    expect((await readManifest(dir)).entries.some((e) => e.fileName === 'sodium-2.jar')).toBe(true)
  })

  it('keeps a disabled jar disabled when updating everything', async () => {
    const { service, mods, dir, client, versions, hashes } = await setup()
    await service.install(ID, 'sodium')
    hashes['sodium-1.jar'] = 'sha1-s1'
    await service.setEnabled(ID, 'sodium-1.jar', false)
    const s2 = ver('s2', SODIUM.id, 'sodium-2.jar', [API.id])
    versions.push(s2)
    client.latest.mockResolvedValue({ 'sha1-s1': s2 })
    const r = await service.updateAll(ID)
    expect(r.updated).toHaveLength(1)
    expect((await readdir(mods)).sort()).toEqual(['fabric-api-1.jar', 'sodium-2.jar.disabled'])
    expect((await readManifest(dir)).entries.find((e) => e.projectId === SODIUM.id)).toMatchObject({
      fileName: 'sodium-2.jar',
      disabled: true
    })
  })

  it('refuses update all while running', async () => {
    const { service } = await setup({ status: 'running' })
    await expect(service.updateAll(ID)).rejects.toMatchObject({ code: 'SERVER_RUNNING' })
  })
})

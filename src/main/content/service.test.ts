import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ServerStatus, ServerType } from '../../shared/types'
import { AppError } from '../errors'
import type { DownloadOptions } from '../net/download'
import { ServerStore } from '../servers/store'
import { tempDir } from '../test-utils'
import { readManifest, writeManifest } from './manifest'
import type { ModrinthClient, ModrinthProject, ModrinthVersion } from './modrinth'
import { ContentService, safeFileName } from './service'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SODIUM: ModrinthProject = {
  id: 'AANobbMI',
  slug: 'sodium',
  title: 'Sodium',
  icon_url: null,
  server_side: 'optional'
}
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
        url: `https://cdn/${filename}`,
        filename,
        primary: true,
        size: 1,
        hashes: { sha1: `sha1-${id}`, sha512: `sha512-${id}` }
      }
    ]
  }
}

async function setup(opts: { type?: ServerType; status?: ServerStatus } = {}) {
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
    if (!p) throw new AppError('MODRINTH_API', 'not found', { status: 404 })
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
  const service = new ContentService({
    store,
    processes,
    client,
    download,
    hashFile: async (p) => hashes[basename(p)] ?? `unknown-${basename(p)}`
  })
  const mods = join(dir, 'mods')
  return { store, dir, mods, client, versions, download, downloads, hashes, processes, service }
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
    await writeManifest(dir, {
      version: 1,
      entries: [
        {
          fileName: 'fabric-api-1.jar',
          projectId: API.id,
          versionId: 'a1',
          title: 'Fabric API',
          versionNumber: '1',
          sha1: 'x',
          dependencyOf: []
        }
      ]
    })
    const r = await service.search(ID, 'sod', 20)
    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({ folder: 'mods' }),
      '1.21.4',
      'sod',
      20
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
    expect((await readManifest(dir)).entries).toEqual([
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
        dependencyOf: [SODIUM.id]
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
    await writeManifest(dir, {
      version: 1,
      entries: [
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
          fileName: 'gone.jar',
          projectId: 'GONEGONE',
          versionId: 'g',
          title: 'Gone',
          versionNumber: 'g',
          sha1: 'g',
          dependencyOf: []
        }
      ]
    })
    client.identify.mockResolvedValueOnce({ 'sha1-a1': ver('a1', API.id, 'fabric-api-1.jar') })
    client.latest.mockResolvedValueOnce({ 'sha1-s1': ver('s2', SODIUM.id, 'sodium-2.jar') })

    const list = await service.listInstalled(ID)
    expect(client.identify).toHaveBeenCalledWith(['sha1-a1', 'unknown-mystery.jar'])
    expect(list.offline).toBe(false)
    expect(list.items).toEqual([
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
    expect(list).toEqual({
      offline: true,
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
  it('keeps the old jar and manifest when a same-name update\'s dependency download fails', async () => {
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
      throw new AppError('MODRINTH_API', 'not found', { status: 404 })
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
    expect((await readManifest(dir)).entries.find((e) => e.projectId === SODIUM.id)).toMatchObject(
      { fileName: 'sodium-1.jar', versionId: 's1' }
    )
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
    await writeManifest(dir, {
      version: 1,
      entries: [
        ...manifest.entries,
        { ...sodiumEntry, fileName: 'sodium-copy.jar', sha1: 'copy-sha' }
      ]
    })

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
    expect((await readManifest(dir)).entries.find((e) => e.projectId === SODIUM.id)).toMatchObject(
      { fileName: 'sodium-1.jar', versionId: 's1' }
    )
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
})

import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupProgress, ServerRecord, ServerStatus } from '../../shared/types'
import { readMeta } from './archive'
import { BackupService } from './service'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'blockhost-backup-svc-'))
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(tmp, { recursive: true, force: true })
})

async function setup(rec: Partial<ServerRecord> = {}) {
  const dir = join(tmp, 'servers', 'survival')
  await mkdir(join(dir, 'world'), { recursive: true })
  await writeFile(join(dir, 'world', 'level.dat'), 'v1')
  await writeFile(join(dir, 'server.properties'), 'server-port=25565\n')
  const records: ServerRecord[] = [
    {
      id: ID,
      name: 'Survival',
      type: 'paper',
      mcVersion: '1.21.4',
      build: '100',
      dir,
      ramMb: 4096,
      port: 25565,
      jvmArgs: [],
      launch: { args: ['-jar', 'server.jar'] },
      installState: 'ready',
      createdAt: '2026-10-01T00:00:00.000Z',
      ...rec
    }
  ]
  const store = {
    get: vi.fn((id: string) => {
      const found = records.find((r) => r.id === id)
      if (!found) throw new Error('Server not found')
      return structuredClone(found)
    }),
    list: vi.fn(() => structuredClone(records)),
    add: vi.fn(async (r: ServerRecord) => {
      records.push(structuredClone(r))
    }),
    update: vi.fn(async (id: string, patch: Partial<ServerRecord>) => {
      const i = records.findIndex((r) => r.id === id)
      records[i] = { ...records[i], ...patch }
      return structuredClone(records[i])
    })
  }
  let status: ServerStatus = 'stopped'
  const commands: string[] = []
  const processes = {
    isActive: vi.fn(() => status === 'running' || status === 'starting' || status === 'stopping'),
    status: vi.fn(() => status),
    sendCommand: vi.fn((_id: string, command: string) => {
      commands.push(command)
    })
  }
  let settings: { backupsDir?: string } = {}
  const progress: BackupProgress[] = []
  const changed: string[] = []
  let clock = new Date('2026-10-23T10:00:00.000Z')
  const service = new BackupService({
    store,
    processes,
    settings: {
      get: () => ({ ...settings }),
      setBackupsDir: async (d) => {
        settings = d === null ? {} : { backupsDir: d }
      }
    },
    defaultRoot: join(tmp, 'data', 'backups'),
    isPortFree: async () => true,
    emitProgress: (e) => progress.push(e),
    emitChanged: (e) => changed.push(e.serverId),
    now: () => clock,
    newId: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    saveTimeoutMs: 1000
  })
  return {
    service,
    store,
    records,
    dir,
    processes,
    commands,
    progress,
    changed,
    setStatus: (s: ServerStatus) => {
      status = s
    },
    setClock: (iso: string) => {
      clock = new Date(iso)
    }
  }
}

describe('BackupService.create', () => {
  it('zips a stopped server without touching the console', async () => {
    const { service, commands, changed, progress } = await setup()
    const info = await service.create(ID, 'manual')
    expect(info).toMatchObject({
      file: '20261023-100000-manual.zip',
      kind: 'manual',
      createdAt: '2026-10-23T10:00:00.000Z'
    })
    expect(info.bytes).toBeGreaterThan(0)
    expect(commands).toEqual([])
    expect(changed).toEqual([ID])
    expect(progress.at(-1)).toEqual({ serverId: ID, op: 'backup', percent: 100 })
    const meta = await readMeta(join(service.dirFor(ID), info.file))
    expect(meta?.server).toMatchObject({ name: 'Survival', type: 'paper', port: 25565 })
  })

  it('runs the save handshake on a running server and turns saving back on', async () => {
    const { service, commands, setStatus } = await setup()
    setStatus('running')
    const pending = service.create(ID, 'manual')
    await vi.waitFor(() => expect(commands).toEqual(['save-off', 'save-all flush']))
    service.onLog({ serverId: ID, lines: ['[12:00:00 INFO]: Saved the game'] })
    await pending
    expect(commands).toEqual(['save-off', 'save-all flush', 'save-on'])
  })

  it('fails on save timeout, still sends save-on, and writes no zip', async () => {
    const { service, commands, setStatus } = await setup()
    setStatus('running')
    await expect(service.create(ID, 'manual')).rejects.toMatchObject({ code: 'SAVE_TIMEOUT' })
    expect(commands).toEqual(['save-off', 'save-all flush', 'save-on'])
    expect((await service.list(ID)).items).toEqual([])
  })

  it('refuses while the server is starting or stopping', async () => {
    const { service, setStatus } = await setup()
    setStatus('starting')
    await expect(service.create(ID, 'manual')).rejects.toMatchObject({ code: 'SERVER_BUSY' })
  })

  it('refuses a second operation on the same server', async () => {
    const { service, setStatus } = await setup()
    setStatus('running')
    const first = service.create(ID, 'manual')
    expect(service.isBusy(ID)).toBe(true)
    await expect(service.create(ID, 'manual')).rejects.toMatchObject({ code: 'BUSY' })
    service.onLog({ serverId: ID, lines: ['Saved the game'] })
    await first
    expect(service.isBusy(ID)).toBe(false)
  })

  it('never reuses a file name within the same second', async () => {
    const { service } = await setup()
    const a = await service.create(ID, 'manual')
    const b = await service.create(ID, 'manual')
    expect(a.file).toBe('20261023-100000-manual.zip')
    expect(b.file).toBe('20261023-100001-manual.zip')
  })

  it('prunes automatic backups beyond keep, leaving manual ones', async () => {
    const { service, setClock } = await setup({ backup: { intervalHours: 1, keep: 2 } })
    await service.create(ID, 'manual')
    for (const hour of ['11', '12', '13']) {
      setClock(`2026-10-23T${hour}:00:00.000Z`)
      await service.create(ID, 'auto')
    }
    const files = (await service.list(ID)).items.map((b) => b.file)
    expect(files).toEqual([
      '20261023-130000-auto.zip',
      '20261023-120000-auto.zip',
      '20261023-100000-manual.zip'
    ])
  })

  it('keeps a successful automatic backup when pruning fails', async () => {
    const { service } = await setup({ backup: { intervalHours: 1, keep: 1 } })
    vi.spyOn(service as unknown as { prune: () => Promise<void> }, 'prune').mockRejectedValue(
      new Error('EPERM')
    )
    const info = await service.create(ID, 'auto')
    expect(info.kind).toBe('auto')
    expect((await service.list(ID)).lastAutoFailure).toBeNull()
  })

  it('records an automatic failure until the next automatic success', async () => {
    const { service, setStatus } = await setup()
    setStatus('running')
    await expect(service.create(ID, 'auto')).rejects.toThrow()
    expect((await service.list(ID)).lastAutoFailure).toMatchObject({
      at: '2026-10-23T10:00:00.000Z'
    })
    setStatus('stopped')
    await service.create(ID, 'auto')
    expect((await service.list(ID)).lastAutoFailure).toBeNull()
  })
})

describe('BackupService location and lookups', () => {
  it('uses the default root until a folder is chosen', async () => {
    const { service } = await setup()
    expect(service.location()).toEqual({ dir: join(tmp, 'data', 'backups'), isDefault: true })
    const chosen = join(tmp, 'elsewhere')
    expect(await service.setLocation(chosen)).toEqual({ dir: chosen, isDefault: false })
    expect(service.dirFor(ID)).toBe(join(chosen, ID))
    expect(await service.setLocation(null)).toEqual({
      dir: join(tmp, 'data', 'backups'),
      isDefault: true
    })
  })

  it('reports latest automatic time and total bytes', async () => {
    const { service, setClock } = await setup()
    expect(await service.latestAutoAt(ID)).toBeNull()
    const a = await service.create(ID, 'auto')
    setClock('2026-10-23T11:00:00.000Z')
    const m = await service.create(ID, 'manual')
    expect(await service.latestAutoAt(ID)).toBe(Date.parse('2026-10-23T10:00:00.000Z'))
    expect(await service.bytes(ID)).toBe(a.bytes + m.bytes)
  })

  it('rejects unsafe or missing file names', async () => {
    const { service } = await setup()
    await expect(service.filePath(ID, '../x.zip')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(service.filePath(ID, 'gone.zip')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('lists nothing for a server with no backup folder', async () => {
    const { service } = await setup()
    expect(await service.list(ID)).toEqual({ items: [], lastAutoFailure: null })
    expect(await readdir(tmp)).not.toContain('data')
  })
})

describe('BackupService.restore', () => {
  it('replaces the folder after taking a pre-restore backup', async () => {
    const { service, dir, setClock } = await setup()
    const backup = await service.create(ID, 'manual')
    await writeFile(join(dir, 'world', 'level.dat'), 'v2')
    await writeFile(join(dir, 'new-file.txt'), 'later')
    setClock('2026-10-23T11:00:00.000Z')

    await service.restore(ID, backup.file)

    expect(await readFile(join(dir, 'world', 'level.dat'), 'utf8')).toBe('v1')
    expect(await readdir(dir)).not.toContain('new-file.txt')
    expect(await readdir(join(tmp, 'servers'))).toEqual(['survival'])
    const kinds = (await service.list(ID)).items.map((b) => b.kind)
    expect(kinds).toEqual(['pre-restore', 'manual'])
  })

  it('refuses while the server runs', async () => {
    const { service, dir, setStatus } = await setup()
    const backup = await service.create(ID, 'manual')
    setStatus('running')
    await expect(service.restore(ID, backup.file)).rejects.toMatchObject({ code: 'SERVER_RUNNING' })
    expect(await readFile(join(dir, 'world', 'level.dat'), 'utf8')).toBe('v1')
  })

  it('leaves the server untouched when the zip is broken', async () => {
    const { service, dir } = await setup()
    await mkdir(service.dirFor(ID), { recursive: true })
    await writeFile(join(service.dirFor(ID), 'broken.zip'), 'not a zip')
    await expect(service.restore(ID, 'broken.zip')).rejects.toThrow()
    expect(await readFile(join(dir, 'world', 'level.dat'), 'utf8')).toBe('v1')
    expect(await readdir(join(tmp, 'servers'))).toEqual(['survival'])
  })

  it('updates the record to the version stored in the backup', async () => {
    const { service, records } = await setup()
    const backup = await service.create(ID, 'manual')
    records[0] = { ...records[0], mcVersion: '1.21.5', build: '7' }
    await service.restore(ID, backup.file)
    expect(records[0]).toMatchObject({ mcVersion: '1.21.4', build: '100' })
  })
})

describe('BackupService.restoreAsNew', () => {
  it('creates a ready server from the backup', async () => {
    const { service, records } = await setup()
    const backup = await service.create(ID, 'manual')
    const target = join(tmp, 'servers', 'copy')
    const rec = await service.restoreAsNew(ID, backup.file, {
      name: 'Survival (restored)',
      dir: target,
      port: 25570
    })
    expect(rec).toMatchObject({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'Survival (restored)',
      type: 'paper',
      mcVersion: '1.21.4',
      build: '100',
      dir: target,
      port: 25570,
      installState: 'ready',
      launch: { args: ['-jar', 'server.jar'] }
    })
    expect(records).toHaveLength(2)
    expect(await readFile(join(target, 'world', 'level.dat'), 'utf8')).toBe('v1')
    expect(await readFile(join(target, 'server.properties'), 'utf8')).toContain('server-port=25570')
  })

  it('rejects a taken name, a non-empty folder, and zips without metadata', async () => {
    const { service, dir } = await setup()
    const backup = await service.create(ID, 'manual')
    const target = join(tmp, 'servers', 'copy')
    await expect(
      service.restoreAsNew(ID, backup.file, { name: 'survival', dir: target, port: 25570 })
    ).rejects.toMatchObject({ code: 'NAME_TAKEN' })
    await expect(
      service.restoreAsNew(ID, backup.file, { name: 'Copy', dir, port: 25570 })
    ).rejects.toMatchObject({ code: 'DIR_NOT_EMPTY' })
    await writeFile(join(service.dirFor(ID), 'hand.zip'), 'x')
    await expect(
      service.restoreAsNew(ID, 'hand.zip', { name: 'Copy', dir: target, port: 25570 })
    ).rejects.toMatchObject({ code: 'NO_METADATA' })
  })
})

describe('BackupService.delete / deleteAll / recover', () => {
  it('deletes one backup and then all of them', async () => {
    const { service, setClock, changed } = await setup()
    const a = await service.create(ID, 'manual')
    setClock('2026-10-23T11:00:00.000Z')
    await service.create(ID, 'manual')
    changed.length = 0
    await service.delete(ID, a.file)
    expect((await service.list(ID)).items).toHaveLength(1)
    expect(changed).toEqual([ID])
    await service.deleteAll(ID)
    expect(await readdir(join(tmp, 'data', 'backups'))).toEqual([])
  })

  it('puts the old folder back after a crash mid-swap and clears leftovers', async () => {
    const { service, dir } = await setup()
    await rename(dir, `${dir}.blockhost-old`)
    await mkdir(`${dir}.blockhost-restoring`, { recursive: true })
    await mkdir(service.dirFor(ID), { recursive: true })
    await writeFile(join(service.dirFor(ID), '20261023-100000-manual.zip.partial'), 'x')

    await service.recover()

    expect(await readFile(join(dir, 'world', 'level.dat'), 'utf8')).toBe('v1')
    expect(await readdir(join(tmp, 'servers'))).toEqual(['survival'])
    expect(await readdir(service.dirFor(ID))).toEqual([])
  })
})

describe('BackupService hardening', () => {
  async function brokenZip(service: { dirFor: (id: string) => string }) {
    await mkdir(service.dirFor(ID), { recursive: true })
    const zip = join(service.dirFor(ID), 'broken.zip')
    await writeFile(zip, 'not a zip')
    return zip
  }

  it('recover drops a leftover old folder when the server folder exists', async () => {
    const { service, dir } = await setup()
    await mkdir(`${dir}.blockhost-old`, { recursive: true })
    await service.recover()
    expect(await readdir(join(tmp, 'servers'))).toEqual(['survival'])
    expect(await readFile(join(dir, 'world', 'level.dat'), 'utf8')).toBe('v1')
  })

  it('recover removes a partial staging folder next to the server', async () => {
    const { service, dir } = await setup()
    await mkdir(`${dir}.blockhost-restoring`, { recursive: true })
    await service.recover()
    expect(await readdir(join(tmp, 'servers'))).toEqual(['survival'])
  })

  it('restore brings back a stranded old folder instead of discarding it', async () => {
    const { service, dir } = await setup()
    const backup = await service.create(ID, 'manual')
    await rename(dir, `${dir}.blockhost-old`)
    await service.restore(ID, backup.file)
    expect(await readFile(join(dir, 'world', 'level.dat'), 'utf8')).toBe('v1')
    expect(await readdir(join(tmp, 'servers'))).toEqual(['survival'])
  })

  it('restoreAsNew keeps a pre-existing empty folder when extraction fails', async () => {
    const { service, records } = await setup()
    await brokenZip(service)
    const target = join(tmp, 'servers', 'copy')
    await mkdir(target, { recursive: true })
    await expect(
      service.restoreAsNew(ID, 'broken.zip', { name: 'Copy', dir: target, port: 25570 })
    ).rejects.toThrow()
    expect(await readdir(target)).toEqual([])
    expect(records).toHaveLength(1)
  })

  it('restoreAsNew removes a folder it created when extraction fails', async () => {
    const { service } = await setup()
    await brokenZip(service)
    const target = join(tmp, 'servers', 'copy')
    await expect(
      service.restoreAsNew(ID, 'broken.zip', { name: 'Copy', dir: target, port: 25570 })
    ).rejects.toThrow()
    expect(await readdir(join(tmp, 'servers'))).toEqual(['survival'])
  })

  it('restoreAsNew cleans up when registering the server fails', async () => {
    const { service, store } = await setup()
    const backup = await service.create(ID, 'manual')
    store.add.mockRejectedValueOnce(new Error('disk full'))
    const target = join(tmp, 'servers', 'copy')
    await expect(
      service.restoreAsNew(ID, backup.file, { name: 'Copy', dir: target, port: 25570 })
    ).rejects.toThrow('disk full')
    expect(await readdir(join(tmp, 'servers'))).toEqual(['survival'])
  })
})

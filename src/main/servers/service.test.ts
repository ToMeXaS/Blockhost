import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ServerRecord, ServerStatus } from '../../shared/types'
import { AppError } from '../errors'
import { tempDir } from '../test-utils'
import { readPropertiesFile, writePropertiesFile } from './properties'
import { ServerService } from './service'
import { ServerStore } from './store'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

async function setup() {
  const root = await tempDir()
  const store = new ServerStore(join(root, 'servers.json'))
  await store.load()
  const dir = join(root, 'srv')
  await mkdir(dir)
  const rec: ServerRecord = {
    id: ID,
    name: 'Survival',
    type: 'paper',
    mcVersion: '26.3',
    dir,
    ramMb: 2048,
    port: 25565,
    jvmArgs: [],
    launch: { args: ['-jar', 'server.jar'] },
    installState: 'ready',
    createdAt: '2026-10-17T12:00:00.000Z'
  }
  await store.add(rec)
  const processes = {
    status: vi.fn((): ServerStatus => 'stopped'),
    isActive: vi.fn(() => false),
    start: vi.fn(),
    stop: vi.fn(),
    kill: vi.fn(async () => {}),
    waitForExit: vi.fn(async () => true),
    sendCommand: vi.fn(),
    getLog: vi.fn((): string[] => [])
  }
  const installer = { create: vi.fn(), retry: vi.fn(), isInstalling: vi.fn(() => false) }
  const java = {
    forStart: vi.fn(async () => 'C:/java/bin/java.exe'),
    requiredMajor: vi.fn(async () => 25)
  }
  const probeJava = vi.fn(async (): Promise<number | null> => 25)
  const isPortFree = vi.fn(async () => true)
  const removeDir = vi.fn(async () => {})
  const service = new ServerService({
    store,
    installer,
    processes,
    java,
    probeJava,
    isPortFree,
    removeDir
  })
  return { store, dir, rec, processes, installer, java, probeJava, isPortFree, removeDir, service }
}

describe('ServerService', () => {
  it('lists servers with their live status', async () => {
    const { processes, service } = await setup()
    processes.status.mockReturnValue('running')
    expect(service.list()).toEqual([expect.objectContaining({ id: ID, status: 'running' })])
  })

  it('starts a ready server with the resolved Java', async () => {
    const { processes, service } = await setup()
    await service.start(ID)
    expect(processes.start).toHaveBeenCalledWith(
      expect.objectContaining({ id: ID }),
      'C:/java/bin/java.exe'
    )
  })

  it('refuses to start when the port is taken', async () => {
    const { processes, isPortFree, service } = await setup()
    isPortFree.mockResolvedValue(false)
    await expect(service.start(ID)).rejects.toMatchObject({
      code: 'PORT_IN_USE',
      details: { port: 25565 }
    })
    expect(processes.start).not.toHaveBeenCalled()
  })

  it('refuses to start an unfinished install', async () => {
    const { store, service } = await setup()
    await store.update(ID, { installState: 'failed' })
    await expect(service.start(ID)).rejects.toMatchObject({ code: 'NOT_INSTALLED' })
  })

  it('propagates JAVA_MISSING from the resolver', async () => {
    const { java, service } = await setup()
    java.forStart.mockRejectedValue(
      new AppError('JAVA_MISSING', 'Java 25 is not installed', { major: 25 })
    )
    await expect(service.start(ID)).rejects.toMatchObject({ code: 'JAVA_MISSING' })
  })

  it('restart stops, waits, then starts', async () => {
    const { processes, service } = await setup()
    processes.isActive.mockReturnValueOnce(true).mockReturnValue(false)
    await service.restart(ID)
    expect(processes.stop).toHaveBeenCalledWith(ID)
    expect(processes.waitForExit).toHaveBeenCalledWith(ID, 30_000)
    expect(processes.start).toHaveBeenCalled()
  })

  it('restart fails with STOP_TIMEOUT if the server will not stop', async () => {
    const { processes, service } = await setup()
    processes.isActive.mockReturnValue(true)
    processes.waitForExit.mockResolvedValue(false)
    await expect(service.restart(ID)).rejects.toMatchObject({ code: 'STOP_TIMEOUT' })
    expect(processes.start).not.toHaveBeenCalled()
  })

  it('rejects a custom Java path that did not come from the picker', async () => {
    const { service } = await setup()
    await expect(service.update(ID, { javaPath: 'C:/evil.exe' })).rejects.toMatchObject({
      code: 'JAVA_NOT_APPROVED'
    })
  })

  it('accepts an approved Java path and warns when it is too old', async () => {
    const { probeJava, service } = await setup()
    probeJava.mockResolvedValue(17)
    service.approveJavaPath('D:/jdk17/bin/java.exe')
    const result = await service.update(ID, { javaPath: 'D:/jdk17/bin/java.exe' })
    expect(result.server.javaPath).toBe('D:/jdk17/bin/java.exe')
    expect(result.warning).toContain('Java 25')
    const cleared = await service.update(ID, { javaPath: null })
    expect(cleared.server.javaPath).toBeUndefined()
  })

  it('rejects an approved Java path that does not run', async () => {
    const { probeJava, service } = await setup()
    probeJava.mockResolvedValue(null)
    service.approveJavaPath('D:/broken.exe')
    await expect(service.update(ID, { javaPath: 'D:/broken.exe' })).rejects.toMatchObject({
      code: 'JAVA_INVALID'
    })
  })

  it('writes a changed port into server.properties', async () => {
    const { dir, service } = await setup()
    const result = await service.update(ID, { port: 25570, ramMb: 4096 })
    expect(result.server).toMatchObject({ port: 25570, ramMb: 4096 })
    expect(await readPropertiesFile(dir)).toEqual([{ key: 'server-port', value: '25570' }])
  })

  it('rejects renaming to an existing name', async () => {
    const { store, rec, service } = await setup()
    await store.add({ ...rec, id: 'other', name: 'Creative', dir: 'C:/x' })
    await expect(service.update(ID, { name: 'creative' })).rejects.toMatchObject({
      code: 'NAME_TAKEN'
    })
  })

  it('syncs server-port from properties back to the record', async () => {
    const { store, dir, service } = await setup()
    await writePropertiesFile(dir, [{ key: 'server-port', value: '25580' }])
    await service.writeProperties(ID, [{ key: 'server-port', value: '25590' }])
    expect(store.get(ID).port).toBe(25590)
  })

  it('removes a server but keeps its files when asked', async () => {
    const { store, removeDir, service } = await setup()
    await service.remove(ID, true)
    expect(store.list()).toEqual([])
    expect(removeDir).not.toHaveBeenCalled()
  })

  it('removes a server and deletes its folder', async () => {
    const { store, dir, removeDir, service } = await setup()
    await service.remove(ID, false)
    expect(store.list()).toEqual([])
    expect(removeDir).toHaveBeenCalledWith(dir)
  })

  it('refuses to remove a running or installing server', async () => {
    const { processes, installer, service } = await setup()
    processes.isActive.mockReturnValue(true)
    await expect(service.remove(ID, false)).rejects.toMatchObject({ code: 'SERVER_RUNNING' })
    processes.isActive.mockReturnValue(false)
    installer.isInstalling.mockReturnValue(true)
    await expect(service.remove(ID, false)).rejects.toMatchObject({ code: 'INSTALLING' })
  })

  it('calls onRemoved with the deleted record', async () => {
    const { store, rec, processes, installer, java, probeJava, isPortFree, removeDir } =
      await setup()
    const onRemoved = vi.fn()
    const service = new ServerService({
      store,
      installer,
      processes,
      java,
      probeJava,
      isPortFree,
      removeDir,
      onRemoved
    })
    await service.remove(rec.id, true)
    expect(onRemoved).toHaveBeenCalledWith(expect.objectContaining({ id: rec.id, name: rec.name }))
  })
})

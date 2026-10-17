import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CreateServerInput, InstallProgress, ServerType } from '../../shared/types'
import { AppError } from '../errors'
import type { ProviderInstallOptions, ServerProvider } from '../providers/types'
import { tempDir } from '../test-utils'
import { ServerInstaller } from './installer'
import { readPropertiesFile } from './properties'
import { ServerStore } from './store'

const ID = '11111111-1111-4111-8111-111111111111'

async function setup() {
  const root = await tempDir()
  const store = new ServerStore(join(root, 'servers.json'))
  await store.load()
  const install = vi.fn(async (opts: ProviderInstallOptions) => {
    opts.onLog('installer says hi')
    opts.onProgress(50)
    await writeFile(join(opts.dir, 'server.jar'), 'jar')
    return { args: ['-jar', 'server.jar'] }
  })
  const provider: ServerProvider = {
    type: 'paper',
    label: 'Paper',
    listVersions: async () => [],
    install
  }
  const providers = { paper: provider } as unknown as Record<ServerType, ServerProvider>
  const java = { forInstall: vi.fn(async () => 'C:/java/bin/java.exe') }
  const events: InstallProgress[] = []
  const installer = new ServerInstaller({
    store,
    providers,
    java,
    emit: (e) => events.push(e),
    newId: () => ID,
    now: () => new Date('2026-10-17T12:00:00Z')
  })
  const input: CreateServerInput = {
    name: 'Survival',
    type: 'paper',
    mcVersion: '26.3',
    dir: join(root, 'servers', 'survival'),
    ramMb: 4096,
    port: 25565,
    eulaAccepted: true
  }
  return { root, store, install, java, events, installer, input }
}

describe('ServerInstaller', () => {
  it('saves an installing record, then installs in the background', async () => {
    const { store, events, installer, input } = await setup()
    const rec = await installer.create(input)
    expect(rec.installState).toBe('installing')
    expect(installer.isInstalling(ID)).toBe(true)
    await installer.waitFor(ID)
    expect(installer.isInstalling(ID)).toBe(false)

    expect(store.get(ID)).toMatchObject({
      installState: 'ready',
      launch: { args: ['-jar', 'server.jar'] },
      createdAt: '2026-10-17T12:00:00.000Z',
      jvmArgs: []
    })
    expect(await readFile(join(input.dir, 'eula.txt'), 'utf8')).toContain('eula=true')
    expect(await readPropertiesFile(input.dir)).toEqual([
      { key: 'server-port', value: '25565' },
      { key: 'motd', value: 'Survival - a Blockhost server' }
    ])
    expect(events.map((e) => e.step)).toEqual(
      expect.arrayContaining(['java', 'server', 'installer', 'config', 'done'])
    )
    expect(events.find((e) => e.percent === 50)?.step).toBe('server')
    expect(installer.getLog(ID)).toContain('installer says hi')
  })

  it('passes the resolved Java and version to the provider', async () => {
    const { install, installer, input } = await setup()
    await installer.create(input)
    await installer.waitFor(ID)
    expect(install).toHaveBeenCalledWith(
      expect.objectContaining({ javaPath: 'C:/java/bin/java.exe', version: '26.3', dir: input.dir })
    )
  })

  it('marks the server failed and reports the error', async () => {
    const { store, install, events, installer, input } = await setup()
    install.mockRejectedValueOnce(new AppError('HTTP', 'Paper API is down'))
    await installer.create(input)
    await installer.waitFor(ID)
    expect(store.get(ID).installState).toBe('failed')
    expect(events.at(-1)).toEqual({ serverId: ID, step: 'error', message: 'Paper API is down' })
  })

  it('retry reinstalls a failed server', async () => {
    const { store, install, installer, input } = await setup()
    install.mockRejectedValueOnce(new Error('boom'))
    await installer.create(input)
    await installer.waitFor(ID)
    await installer.retry(ID)
    await installer.waitFor(ID)
    expect(store.get(ID).installState).toBe('ready')
  })

  it('rejects retry on a server that is not failed', async () => {
    const { install, installer, input } = await setup()
    await installer.create(input)
    await installer.waitFor(ID)
    install.mockClear()
    await expect(installer.retry(ID)).rejects.toMatchObject({ code: 'NOT_FAILED' })
    expect(install).not.toHaveBeenCalled()
  })

  it('rejects retry while an install is already in flight', async () => {
    const { installer, input } = await setup()
    await installer.create(input)
    expect(installer.isInstalling(ID)).toBe(true)
    await expect(installer.retry(ID)).rejects.toMatchObject({ code: 'INSTALLING' })
    await installer.waitFor(ID)
  })

  it('validates EULA, unique names and empty folders', async () => {
    const { root, installer, input } = await setup()
    await expect(installer.create({ ...input, eulaAccepted: false })).rejects.toMatchObject({
      code: 'EULA_REQUIRED'
    })
    await installer.create(input)
    await installer.waitFor(ID)
    await expect(
      installer.create({ ...input, name: 'SURVIVAL', dir: join(root, 'other') })
    ).rejects.toMatchObject({ code: 'NAME_TAKEN' })
    await expect(installer.create({ ...input, name: 'Other' })).rejects.toMatchObject({
      code: 'DIR_IN_USE'
    })
    const busy = join(root, 'busy')
    await mkdir(busy)
    await writeFile(join(busy, 'file.txt'), '')
    await expect(installer.create({ ...input, name: 'Busy', dir: busy })).rejects.toMatchObject({
      code: 'DIR_NOT_EMPTY'
    })
  })
})

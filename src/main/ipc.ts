import { dialog, ipcMain, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { totalmem } from 'node:os'
import { z } from 'zod'
import type { InvokeChannel } from '../shared/api'
import type { Result, UpdateStatus } from '../shared/types'
import { AppError, toApiError } from './errors'
import { lanIps, publicIp } from './net/ip'
import { isPortFree } from './net/port'
import {
  commandSchema,
  createServerSchema,
  httpsUrlSchema,
  idSchema,
  javaMajorSchema,
  playerActionSchema,
  portSchema,
  propertyEntriesSchema,
  serverPatchSchema,
  serverTypeSchema,
  versionSchema
} from './schemas'
import type { Services } from './services'

function handle<A extends unknown[]>(
  channel: InvokeChannel,
  schema: z.ZodType<A>,
  fn: (...args: A) => unknown
): void {
  ipcMain.handle(channel, async (_event, ...raw: unknown[]): Promise<Result<unknown>> => {
    try {
      const args = schema.parse(raw)
      return { ok: true, data: await fn(...args) }
    } catch (err) {
      return { ok: false, error: toApiError(err) }
    }
  })
}

export function registerIpc(
  services: Services,
  getWindow: () => BrowserWindow | null,
  updates: { status(): UpdateStatus; requestInstall(): void }
): void {
  const { servers, installer, providers, javaManager, http, paths, players } = services

  const openDialog = async (options: OpenDialogOptions): Promise<string | null> => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }

  handle('providers:listVersions', z.tuple([serverTypeSchema]), (type) =>
    providers[type].listVersions()
  )
  handle(
    'providers:listBuilds',
    z.tuple([serverTypeSchema, versionSchema]),
    async (type, version) => (await providers[type].listBuilds?.(version)) ?? []
  )

  handle('servers:list', z.tuple([]), () => servers.list())
  handle('servers:create', z.tuple([createServerSchema]), (input) => servers.create(input))
  handle('servers:retryInstall', z.tuple([idSchema]), (id) => servers.retryInstall(id))
  handle('servers:update', z.tuple([idSchema, serverPatchSchema]), (id, patch) =>
    servers.update(id, patch)
  )
  handle('servers:remove', z.tuple([idSchema, z.boolean()]), (id, keepFiles) =>
    servers.remove(id, keepFiles)
  )
  handle('servers:start', z.tuple([idSchema]), (id) => servers.start(id))
  handle('servers:stop', z.tuple([idSchema]), (id) => servers.stop(id))
  handle('servers:restart', z.tuple([idSchema]), (id) => servers.restart(id))
  handle('servers:kill', z.tuple([idSchema]), (id) => servers.kill(id))
  handle('servers:sendCommand', z.tuple([idSchema, commandSchema]), (id, command) =>
    servers.sendCommand(id, command)
  )
  handle('servers:getLog', z.tuple([idSchema]), (id) => servers.getLog(id))
  handle('servers:getInstallLog', z.tuple([idSchema]), (id) => installer.getLog(id))
  handle('servers:readProperties', z.tuple([idSchema]), (id) => servers.readProperties(id))
  handle('servers:writeProperties', z.tuple([idSchema, propertyEntriesSchema]), (id, entries) =>
    servers.writeProperties(id, entries)
  )
  handle('servers:openFolder', z.tuple([idSchema]), async (id) => {
    const error = await shell.openPath(servers.dir(id))
    if (error) throw new AppError('OPEN_FAILED', error)
  })

  handle('players:get', z.tuple([idSchema]), (id) => players.getPlayers(id))
  handle('players:action', z.tuple([idSchema, playerActionSchema]), (id, action) =>
    players.action(id, action)
  )

  handle('java:install', z.tuple([javaMajorSchema]), async (major) => {
    await javaManager.ensure(major)
  })

  handle('system:info', z.tuple([]), () => ({
    totalRamMb: Math.floor(totalmem() / 1024 / 1024),
    defaultServersDir: paths.serversDir
  }))
  handle('system:netInfo', z.tuple([portSchema]), async (port) => ({
    lanIps: lanIps(),
    publicIp: await publicIp(http),
    port
  }))
  handle('system:checkPort', z.tuple([portSchema]), (port) => isPortFree(port))
  handle('system:pickFolder', z.tuple([]), () =>
    openDialog({
      title: 'Choose a folder for your servers',
      properties: ['openDirectory', 'createDirectory']
    })
  )
  handle('system:pickJava', z.tuple([]), async () => {
    const path = await openDialog({
      title: 'Choose java.exe',
      properties: ['openFile'],
      filters: [{ name: 'Java', extensions: ['exe'] }]
    })
    if (path) servers.approveJavaPath(path)
    return path
  })
  handle('system:openExternal', z.tuple([httpsUrlSchema]), (url) => shell.openExternal(url))

  handle('update:getStatus', z.tuple([]), () => updates.status())
  handle('update:install', z.tuple([]), () => updates.requestInstall())
}

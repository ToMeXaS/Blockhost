import { app, BrowserWindow, dialog, shell, type MessageBoxOptions } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { EventChannel, EventPayloads } from '../shared/api'
import { AppError } from './errors'
import { registerIpc } from './ipc'
import { createServices, type Services } from './services'
import { UpdateService } from './updater'

const QUIT_STOP_TIMEOUT_MS = 60_000

let mainWindow: BrowserWindow | null = null
let services: Services | null = null
let updates: UpdateService | null = null
let quitting = false
let confirming = false

function send<C extends EventChannel>(channel: C, payload: EventPayloads[C]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function shouldConfirmQuit(): boolean {
  return !quitting && !!services && services.processes.activeIds().length > 0
}

function quitNow(): void {
  app.quit()
}

async function confirmQuit(finish: () => void = quitNow): Promise<void> {
  if (confirming || !services) return
  confirming = true
  try {
    const { processes } = services
    const ids = processes.activeIds()
    const installing = finish !== quitNow
    const options: MessageBoxOptions = {
      type: 'question',
      buttons: ['Stop servers and quit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Blockhost',
      message:
        ids.length === 1
          ? 'A server is still running.'
          : `${ids.length} servers are still running.`,
      detail: installing
        ? 'Blockhost will send "stop" to each server so the worlds are saved, then restart to install the update.'
        : 'Blockhost will send "stop" to each server so the worlds are saved, then quit.'
    }
    const { response } = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options)
    if (response !== 0) return
    quitting = true
    for (const id of ids) processes.stop(id)
    const stopped = await Promise.all(
      ids.map((id) => processes.waitForExit(id, QUIT_STOP_TIMEOUT_MS))
    )
    await Promise.all(ids.filter((_, i) => !stopped[i]).map((id) => processes.kill(id)))
    try {
      finish()
    } catch (err) {
      quitting = false
      console.error('Blockhost: failed to finish quit', err)
    }
  } finally {
    confirming = false
  }
}

function requestUpdateInstall(): void {
  if (!updates) return
  if (updates.status().state !== 'ready')
    throw new AppError('NO_UPDATE', 'No update is ready to install')
  if (shouldConfirmQuit()) {
    void confirmQuit(() => updates!.install())
  } else {
    quitting = true
    try {
      updates.install()
    } catch (err) {
      quitting = false
      throw err
    }
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Blockhost',
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => win.show())
  win.on('close', (event) => {
    if (shouldConfirmQuit()) {
      event.preventDefault()
      void confirmQuit()
    }
  })
  win.on('closed', () => {
    mainWindow = null
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('before-quit', (event) => {
  if (shouldConfirmQuit()) {
    event.preventDefault()
    void confirmQuit()
  }
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => services?.tunnels.dispose())

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.blockhost.app')
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
    try {
      services = await createServices({
        dataDir: join(app.getPath('appData'), 'Blockhost'),
        serversDir: join(app.getPath('documents'), 'MinecraftServers'),
        send,
        openUrl: (url) => shell.openExternal(url)
      })
    } catch (err) {
      dialog.showErrorBox(
        'Blockhost could not start',
        err instanceof Error ? err.message : String(err)
      )
      app.exit(1)
      return
    }
    updates = new UpdateService({
      updater: autoUpdater,
      enabled: app.isPackaged,
      currentVersion: app.getVersion(),
      emit: (status) => send('update:status', status)
    })
    registerIpc(services, () => mainWindow, {
      status: () => updates!.status(),
      requestInstall: requestUpdateInstall
    })
    createWindow()
    updates.start()
  })
}

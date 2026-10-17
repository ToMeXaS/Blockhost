import extract from 'extract-zip'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { EventChannel, EventPayloads } from '../shared/api'
import type { ServerType } from '../shared/types'
import { JsonCache } from './cache'
import { probeJava } from './java/detect'
import { JavaManager } from './java/manager'
import { JavaResolver } from './java/resolver'
import { runJava } from './java/run'
import { downloadFile } from './net/download'
import { createHttpClient, type HttpClient } from './net/http'
import { isPortFree } from './net/port'
import { createProviders } from './providers'
import type { ServerProvider } from './providers/types'
import { createMojangJavaLookup } from './providers/vanilla'
import { ServerInstaller } from './servers/installer'
import { defaultSpawn, killTree, ProcessManager } from './servers/process'
import { ServerService } from './servers/service'
import { ServerStore } from './servers/store'

export type SendEvent = <C extends EventChannel>(channel: C, payload: EventPayloads[C]) => void

export interface Services {
  paths: { dataDir: string; serversDir: string }
  http: HttpClient
  providers: Record<ServerType, ServerProvider>
  javaManager: JavaManager
  installer: ServerInstaller
  processes: ProcessManager
  servers: ServerService
}

export async function createServices(opts: {
  dataDir: string
  serversDir: string
  send: SendEvent
}): Promise<Services> {
  const { dataDir, serversDir, send } = opts
  const http = createHttpClient({
    cache: new JsonCache(join(dataDir, 'cache')),
    onStale: (url) => send('net:offline', { url })
  })
  const providers = createProviders({ http, download: downloadFile, runJava })
  const javaManager = new JavaManager({
    root: join(dataDir, 'java'),
    http,
    download: downloadFile,
    extractZip: (zipPath, destDir) => extract(zipPath, { dir: destDir })
  })
  const java = new JavaResolver({
    manager: javaManager,
    mojangJavaMajor: createMojangJavaLookup(http),
    probe: probeJava
  })
  const store = new ServerStore(join(dataDir, 'servers.json'))
  await store.load()
  const installer = new ServerInstaller({
    store,
    providers,
    java,
    emit: (progress) => send('install:progress', progress)
  })
  const processes = new ProcessManager({
    spawn: defaultSpawn,
    kill: killTree,
    onStatus: (event) => send('server:status', event),
    onLog: (event) => send('server:log', event)
  })
  const servers = new ServerService({
    store,
    installer,
    processes,
    java,
    probeJava,
    isPortFree: (port) => isPortFree(port),
    removeDir: (dir) => rm(dir, { recursive: true, force: true })
  })
  return {
    paths: { dataDir, serversDir },
    http,
    providers,
    javaManager,
    installer,
    processes,
    servers
  }
}

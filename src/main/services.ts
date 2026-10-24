import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { EventChannel, EventPayloads } from '../shared/api'
import type { ServerType } from '../shared/types'
import { BackupScheduler } from './backups/scheduler'
import { BackupService } from './backups/service'
import { JsonCache } from './cache'
import { folderBytes } from './disk/usage'
import { createContentProviders } from './content/providers'
import { ContentService } from './content/service'
import { probeJava } from './java/detect'
import { extractZip } from './java/extract'
import { JavaManager } from './java/manager'
import { JavaResolver } from './java/resolver'
import { runJava } from './java/run'
import { downloadFile } from './net/download'
import { createHttpClient, type HttpClient } from './net/http'
import { isPortFree } from './net/port'
import { defaultWatch, PlayerService } from './players/service'
import { lookupPlayer } from './players/uuid'
import { createProviders } from './providers'
import type { ServerProvider } from './providers/types'
import { createMojangJavaLookup } from './providers/vanilla'
import { ServerInstaller } from './servers/installer'
import { defaultSpawn, killTree, ProcessManager } from './servers/process'
import { ServerService } from './servers/service'
import { ServerStore } from './servers/store'
import { SettingsStore } from './settings'
import { ProcessSampler } from './stats/sampler'
import { StatsService } from './stats/service'
import { PlayitAccount } from './tunnel/account'
import { AgentProcess } from './tunnel/agent'
import { createPlayitApi } from './tunnel/api'
import { PlayitdBinary } from './tunnel/binary'
import { TunnelService } from './tunnel/service'

export type SendEvent = <C extends EventChannel>(channel: C, payload: EventPayloads[C]) => void

export interface Services {
  paths: { dataDir: string; serversDir: string }
  http: HttpClient
  providers: Record<ServerType, ServerProvider>
  javaManager: JavaManager
  installer: ServerInstaller
  processes: ProcessManager
  servers: ServerService
  players: PlayerService
  tunnels: TunnelService
  content: ContentService
  stats: StatsService
  backups: BackupService
  backupScheduler: BackupScheduler
  settings: SettingsStore
}

export async function createServices(opts: {
  dataDir: string
  serversDir: string
  send: SendEvent
  openUrl: (url: string) => Promise<void>
  appVersion: string
}): Promise<Services> {
  const { dataDir, serversDir, send, openUrl, appVersion } = opts
  const http = createHttpClient({
    cache: new JsonCache(join(dataDir, 'cache')),
    onStale: (url) => send('net:offline', { url })
  })
  const providers = createProviders({ http, download: downloadFile, runJava })
  const javaManager = new JavaManager({
    root: join(dataDir, 'java'),
    http,
    download: downloadFile,
    extractZip
  })
  const java = new JavaResolver({
    manager: javaManager,
    mojangJavaMajor: createMojangJavaLookup(http),
    probe: probeJava
  })
  const store = new ServerStore(join(dataDir, 'servers.json'))
  await store.load()
  const settings = new SettingsStore(join(dataDir, 'settings.json'))
  await settings.load()
  const installer = new ServerInstaller({
    store,
    providers,
    java,
    emit: (progress) => send('install:progress', progress)
  })
  const processes = new ProcessManager({
    spawn: defaultSpawn,
    kill: killTree,
    onStatus: (event) => {
      send('server:status', event)
      players.onStatus(event)
      tunnels.onServerStatus(event)
      stats.onStatus(event)
    },
    onLog: (event) => {
      send('server:log', event)
      players.onLog(event)
      backups.onLog(event)
    },
    onQuietLine: (serverId, line) => {
      stats.onQuietLine(serverId, line)
      players.onQuietLine(serverId, line)
    }
  })
  const players = new PlayerService({
    store,
    processes,
    lookup: (name, onlineMode) => lookupPlayer(http, name, onlineMode),
    watch: defaultWatch,
    emit: (event) => send('players:changed', event)
  })
  const sampler = new ProcessSampler({
    spawn: defaultSpawn,
    onSample: (sample) => stats.onSample(sample)
  })
  const stats = new StatsService({
    store,
    processes,
    sampler,
    emit: (event) => send('stats:sample', event)
  })
  const playitDir = join(dataDir, 'playit')
  const playitApi = createPlayitApi()
  const playitBinary = new PlayitdBinary({ dir: playitDir, download: downloadFile })
  const playitAccount = new PlayitAccount({
    file: join(playitDir, 'playit.toml'),
    api: playitApi,
    openUrl
  })
  const playitAgent = new AgentProcess({
    spawn: defaultSpawn,
    kill: killTree,
    exe: () => playitBinary.ensure(),
    secretPath: join(playitDir, 'playit.toml'),
    onEvent: (event) => tunnels.onAgentEvent(event)
  })
  const tunnels = new TunnelService({
    store,
    processes,
    account: playitAccount,
    api: playitApi,
    binary: playitBinary,
    agent: playitAgent,
    emit: (status) => send('tunnel:status', status)
  })
  const content = new ContentService({
    store,
    processes,
    providers: createContentProviders({
      userAgent: `Blockhost/${appVersion} (github.com/ToMeXaS/blockhost)`
    }),
    download: downloadFile
  })
  const backups = new BackupService({
    store,
    processes,
    settings,
    defaultRoot: join(dataDir, 'backups'),
    isPortFree: (port) => isPortFree(port),
    emitProgress: (event) => send('backup:progress', event),
    emitChanged: (event) => send('backups:changed', event)
  })
  await backups.recover()
  const backupScheduler = new BackupScheduler({
    servers: () => store.list(),
    status: (id) => processes.status(id),
    isBusy: (id) => backups.isBusy(id),
    latestAutoAt: (id) => backups.latestAutoAt(id),
    backup: (id) => backups.create(id, 'auto')
  })
  const servers = new ServerService({
    store,
    installer,
    processes,
    java,
    probeJava,
    isPortFree: (port) => isPortFree(port),
    removeDir: (dir) => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }),
    folderBytes,
    onRemoved: (rec) => tunnels.onServerRemoved(rec),
    isBackupBusy: (id) => backups.isBusy(id),
    removeBackups: (id) => backups.deleteAll(id)
  })
  return {
    paths: { dataDir, serversDir },
    http,
    providers,
    javaManager,
    installer,
    processes,
    servers,
    players,
    tunnels,
    content,
    stats,
    backups,
    backupScheduler,
    settings
  }
}

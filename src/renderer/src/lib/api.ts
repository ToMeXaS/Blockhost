import type { Bridge, EventChannel, EventPayloads, InvokeChannel } from '../../../shared/api'
import type {
  ApiError,
  BackupInfo,
  BackupList,
  BackupLocation,
  BackupMeta,
  ContentInstallResult,
  ContentSearchResult,
  CreateServerInput,
  DiskUsage,
  InstalledContentList,
  NetInfo,
  PlayerAction,
  PlayerLists,
  PlayitAccountStatus,
  PropertyEntry,
  RestoreAsNewInput,
  ServerRecord,
  ServerPatch,
  ServerType,
  ServerView,
  StatsSnapshot,
  SystemInfo,
  TunnelStatus,
  UpdateResult,
  UpdateStatus,
  VersionInfo,
  WorldInfo
} from '../../../shared/types'

export class ApiCallError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(error: ApiError) {
    super(error.message)
    this.name = 'ApiCallError'
    this.code = error.code
    this.details = error.details
  }
}

const bridge: Bridge = window.blockhost

async function call<T>(channel: InvokeChannel, ...args: unknown[]): Promise<T> {
  const result = await bridge.invoke(channel, ...args)
  if (!result.ok) throw new ApiCallError(result.error)
  return result.data as T
}

export const api = {
  listVersions: (type: ServerType) => call<VersionInfo[]>('providers:listVersions', type),
  listBuilds: (type: ServerType, version: string) =>
    call<VersionInfo[]>('providers:listBuilds', type, version),

  listServers: () => call<ServerView[]>('servers:list'),
  createServer: (input: CreateServerInput) => call<ServerView>('servers:create', input),
  retryInstall: (id: string) => call<ServerView>('servers:retryInstall', id),
  updateServer: (id: string, patch: ServerPatch) => call<UpdateResult>('servers:update', id, patch),
  removeServer: (id: string, keepFiles: boolean, deleteBackups = false) =>
    call<void>('servers:remove', id, keepFiles, deleteBackups),
  start: (id: string) => call<void>('servers:start', id),
  stop: (id: string) => call<void>('servers:stop', id),
  restart: (id: string) => call<void>('servers:restart', id),
  kill: (id: string) => call<void>('servers:kill', id),
  sendCommand: (id: string, command: string) => call<void>('servers:sendCommand', id, command),
  getLog: (id: string) => call<string[]>('servers:getLog', id),
  getInstallLog: (id: string) => call<string[]>('servers:getInstallLog', id),
  readProperties: (id: string) => call<PropertyEntry[]>('servers:readProperties', id),
  writeProperties: (id: string, entries: PropertyEntry[]) =>
    call<void>('servers:writeProperties', id, entries),
  openFolder: (id: string) => call<void>('servers:openFolder', id),
  getPlayers: (id: string) => call<PlayerLists>('players:get', id),
  playerAction: (id: string, action: PlayerAction) =>
    call<PlayerLists>('players:action', id, action),
  statsGet: (id: string) => call<StatsSnapshot>('stats:get', id),
  diskGet: (id: string) => call<DiskUsage>('disk:get', id),
  worldsGet: (id: string) => call<WorldInfo[]>('worlds:get', id),
  backupsList: (id: string) => call<BackupList>('backups:list', id),
  backupsCreate: (id: string) => call<BackupInfo>('backups:create', id),
  backupsRestore: (id: string, file: string) => call<void>('backups:restore', id, file),
  backupsRestoreAsNew: (id: string, file: string, input: RestoreAsNewInput) =>
    call<ServerRecord>('backups:restoreAsNew', id, file, input),
  backupsDelete: (id: string, file: string) => call<void>('backups:delete', id, file),
  backupsReveal: (id: string, file: string) => call<void>('backups:reveal', id, file),
  backupsOpenFolder: (id: string) => call<void>('backups:openFolder', id),
  backupsMeta: (id: string, file: string) => call<BackupMeta | null>('backups:meta', id, file),
  backupsLocation: () => call<BackupLocation>('backups:location'),
  backupsPickLocation: () => call<BackupLocation>('backups:pickLocation'),
  backupsResetLocation: () => call<BackupLocation>('backups:resetLocation'),

  tunnelAccount: () => call<PlayitAccountStatus>('tunnel:account'),
  tunnelLink: () => call<void>('tunnel:link'),
  tunnelCancelLink: () => call<void>('tunnel:cancelLink'),
  tunnelUnlink: () => call<void>('tunnel:unlink'),
  tunnelSetShared: (id: string, enabled: boolean) =>
    call<TunnelStatus>('tunnel:setShared', id, enabled),
  tunnelStatus: (id: string) => call<TunnelStatus>('tunnel:status', id),
  tunnelRetry: (id: string) => call<TunnelStatus>('tunnel:retry', id),

  contentSearch: (id: string, query: string, offset: number) =>
    call<ContentSearchResult>('content:search', id, query, offset),
  contentInstalled: (id: string) => call<InstalledContentList>('content:installed', id),
  contentInstall: (id: string, projectId: string) =>
    call<ContentInstallResult>('content:install', id, projectId),
  contentUpdate: (id: string, fileName: string) =>
    call<ContentInstallResult>('content:update', id, fileName),
  contentRemove: (id: string, fileName: string) => call<void>('content:remove', id, fileName),

  installJava: (major: number) => call<void>('java:install', major),
  systemInfo: () => call<SystemInfo>('system:info'),
  netInfo: (port: number) => call<NetInfo>('system:netInfo', port),
  checkPort: (port: number) => call<boolean>('system:checkPort', port),
  pickFolder: () => call<string | null>('system:pickFolder'),
  pickJava: () => call<string | null>('system:pickJava'),
  openExternal: (url: string) => call<void>('system:openExternal', url),

  getUpdateStatus: () => call<UpdateStatus>('update:getStatus'),
  installUpdate: () => call<void>('update:install'),

  on: <C extends EventChannel>(channel: C, listener: (payload: EventPayloads[C]) => void) =>
    bridge.on(channel, listener)
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

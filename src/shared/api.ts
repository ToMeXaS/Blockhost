import type {
  BackupProgress,
  BackupsChangedEvent,
  InstallProgress,
  PlayersChangedEvent,
  Result,
  ServerLogEvent,
  ServerStatusEvent,
  StatsSampleEvent,
  TunnelStatus,
  UpdateStatus
} from './types'

export const INVOKE_CHANNELS = [
  'providers:listVersions',
  'providers:listBuilds',
  'servers:list',
  'servers:create',
  'servers:retryInstall',
  'servers:update',
  'servers:remove',
  'servers:start',
  'servers:stop',
  'servers:restart',
  'servers:kill',
  'servers:sendCommand',
  'servers:getLog',
  'servers:getInstallLog',
  'servers:readProperties',
  'servers:writeProperties',
  'servers:openFolder',
  'players:get',
  'players:action',
  'stats:get',
  'disk:get',
  'worlds:get',
  'backups:list',
  'backups:create',
  'backups:restore',
  'backups:restoreAsNew',
  'backups:delete',
  'backups:reveal',
  'backups:openFolder',
  'backups:meta',
  'backups:location',
  'backups:pickLocation',
  'backups:resetLocation',
  'tunnel:account',
  'tunnel:link',
  'tunnel:cancelLink',
  'tunnel:unlink',
  'tunnel:setShared',
  'tunnel:status',
  'tunnel:retry',
  'content:sources',
  'content:search',
  'content:project',
  'content:versions',
  'content:plan',
  'content:installed',
  'content:install',
  'content:update',
  'content:remove',
  'content:setEnabled',
  'content:updateAll',
  'content:orphans',
  'content:setIncludeBeta',
  'java:install',
  'system:info',
  'system:netInfo',
  'system:checkPort',
  'system:pickFolder',
  'system:pickJava',
  'system:openExternal',
  'update:getStatus',
  'update:install',
  'update:check',
  'update:download',
  'update:setAuto'
] as const
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]

export const EVENT_CHANNELS = [
  'server:status',
  'server:log',
  'players:changed',
  'stats:sample',
  'backup:progress',
  'backups:changed',
  'tunnel:status',
  'install:progress',
  'net:offline',
  'update:status',
  'content:updates'
] as const
export type EventChannel = (typeof EVENT_CHANNELS)[number]

export interface EventPayloads {
  'server:status': ServerStatusEvent
  'server:log': ServerLogEvent
  'players:changed': PlayersChangedEvent
  'stats:sample': StatsSampleEvent
  'backup:progress': BackupProgress
  'backups:changed': BackupsChangedEvent
  'tunnel:status': TunnelStatus
  'install:progress': InstallProgress
  'net:offline': { url: string }
  'update:status': UpdateStatus
  'content:updates': { serverId: string; count: number }
}

/** What the preload script exposes as `window.blockhost`. */
export interface Bridge {
  invoke(channel: InvokeChannel, ...args: unknown[]): Promise<Result<unknown>>
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayloads[C]) => void): () => void
}

import type {
  InstallProgress,
  PlayersChangedEvent,
  Result,
  ServerLogEvent,
  ServerStatusEvent,
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
  'tunnel:account',
  'tunnel:link',
  'tunnel:cancelLink',
  'tunnel:unlink',
  'tunnel:setShared',
  'tunnel:status',
  'tunnel:retry',
  'java:install',
  'system:info',
  'system:netInfo',
  'system:checkPort',
  'system:pickFolder',
  'system:pickJava',
  'system:openExternal',
  'update:getStatus',
  'update:install'
] as const
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]

export const EVENT_CHANNELS = [
  'server:status',
  'server:log',
  'players:changed',
  'tunnel:status',
  'install:progress',
  'net:offline',
  'update:status'
] as const
export type EventChannel = (typeof EVENT_CHANNELS)[number]

export interface EventPayloads {
  'server:status': ServerStatusEvent
  'server:log': ServerLogEvent
  'players:changed': PlayersChangedEvent
  'tunnel:status': TunnelStatus
  'install:progress': InstallProgress
  'net:offline': { url: string }
  'update:status': UpdateStatus
}

/** What the preload script exposes as `window.blockhost`. */
export interface Bridge {
  invoke(channel: InvokeChannel, ...args: unknown[]): Promise<Result<unknown>>
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayloads[C]) => void): () => void
}

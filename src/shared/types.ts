export const SERVER_TYPES = ['vanilla', 'paper', 'purpur', 'fabric', 'forge', 'neoforge'] as const
export type ServerType = (typeof SERVER_TYPES)[number]

export const SERVER_TYPE_LABELS: Record<ServerType, string> = {
  vanilla: 'Vanilla',
  paper: 'Paper',
  purpur: 'Purpur',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

/** Server types whose provider offers a build picker. */
export const TYPES_WITH_BUILDS: readonly ServerType[] = ['paper', 'purpur']

export interface VersionInfo {
  id: string
  stable: boolean
}

/** Arguments placed after the JVM memory/extra args and before `nogui`. */
export interface LaunchSpec {
  args: string[]
}

export type InstallState = 'installing' | 'ready' | 'failed'
export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed'

export interface ServerRecord {
  id: string
  name: string
  type: ServerType
  mcVersion: string
  build?: string
  dir: string
  ramMb: number
  port: number
  javaPath?: string
  jvmArgs: string[]
  launch?: LaunchSpec
  installState: InstallState
  createdAt: string
}

export interface ServerView extends ServerRecord {
  status: ServerStatus
}

export interface CreateServerInput {
  name: string
  type: ServerType
  mcVersion: string
  build?: string
  dir: string
  ramMb: number
  port: number
  eulaAccepted: boolean
}

export interface ServerPatch {
  name?: string
  ramMb?: number
  port?: number
  /** `null` switches back to the automatically managed Java. */
  javaPath?: string | null
  jvmArgs?: string[]
}

export interface UpdateResult {
  server: ServerView
  warning?: string
}

export type InstallStep = 'java' | 'server' | 'installer' | 'config' | 'done' | 'error'

export interface InstallProgress {
  serverId: string
  step: InstallStep
  message: string
  percent?: number
}

export interface ServerStatusEvent {
  serverId: string
  status: ServerStatus
}

export interface ServerLogEvent {
  serverId: string
  lines: string[]
}

export interface PropertyEntry {
  key: string
  value: string
}

export interface SystemInfo {
  totalRamMb: number
  defaultServersDir: string
}

export interface NetInfo {
  lanIps: string[]
  publicIp: string | null
  port: number
}

export interface ApiError {
  code: string
  message: string
  details?: Record<string, unknown>
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  /** Version being downloaded / ready to install. */
  version?: string
  percent?: number
  message?: string
}

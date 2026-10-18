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
  tunnel?: ServerTunnel
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

/** Minecraft Java usernames: 3–16 letters, digits or underscores. */
export const PLAYER_NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/

export interface PlayerRef {
  uuid: string
  name: string
}

export interface OpEntry extends PlayerRef {
  level: number
}

export interface PlayerBan extends PlayerRef {
  reason: string
  created: string
}

export interface IpBan {
  ip: string
  reason: string
  created: string
}

export type PlayerListName = 'ops' | 'whitelist' | 'bannedPlayers' | 'bannedIps'

export interface PlayerLists {
  /** Empty unless the server is running. */
  online: string[]
  ops: OpEntry[]
  whitelist: PlayerRef[]
  whitelistEnabled: boolean
  bannedPlayers: PlayerBan[]
  bannedIps: IpBan[]
  /** Lists whose file could not be parsed (shown as empty). */
  corrupt: PlayerListName[]
}

export type PlayerAction = {
  /** Stopped servers only: replace a list file that could not be parsed. */
  overwriteCorrupt?: boolean
} & (
  | { type: 'op'; name: string }
  | { type: 'deop'; name: string }
  | { type: 'whitelistAdd'; name: string }
  | { type: 'whitelistRemove'; name: string }
  | { type: 'setWhitelistEnabled'; enabled: boolean }
  | { type: 'ban'; name: string; reason?: string }
  | { type: 'pardon'; name: string }
  | { type: 'banIp'; ip: string; reason?: string }
  | { type: 'pardonIp'; ip: string }
  | { type: 'kick'; name: string; reason?: string }
)

export interface PlayersChangedEvent {
  serverId: string
}

export interface ServerTunnel {
  enabled: boolean
  tunnelId?: string
  address?: string
}

export type TunnelState = 'off' | 'downloading' | 'connecting' | 'online' | 'needs-setup' | 'error'

export interface TunnelStatus {
  serverId: string
  state: TunnelState
  /** Public address, kept from the last time playit reported it. */
  address?: string
  /** Where the tunnel must point, e.g. 127.0.0.1:25565. */
  localAddress: string
  message?: string
  percent?: number
}

export interface PlayitAccountStatus {
  linked: boolean
}

export type ContentLabel = 'Mods' | 'Plugins'

/** Which content tab a server type gets (null = none). */
export const CONTENT_LABELS: Record<ServerType, ContentLabel | null> = {
  vanilla: null,
  paper: 'Plugins',
  purpur: 'Plugins',
  fabric: 'Mods',
  forge: 'Mods',
  neoforge: 'Mods'
}

export interface ContentSearchHit {
  projectId: string
  slug: string
  title: string
  description: string
  iconUrl: string | null
  downloads: number
  installed: boolean
}

export interface ContentSearchResult {
  hits: ContentSearchHit[]
  total: number
}

export interface InstalledContent {
  fileName: string
  title: string
  versionNumber: string | null
  source: 'modrinth' | 'manual'
  projectId?: string
  update?: { versionId: string; versionNumber: string }
  /** Titles of installed content that pulled this in as a dependency. */
  neededBy: string[]
}

export interface InstalledContentList {
  items: InstalledContent[]
  /** True when Modrinth could not be reached; items are local files only. */
  offline: boolean
}

export interface ContentInstallResult {
  installed: { title: string; versionNumber: string; asDependency: boolean }[]
  restartNeeded: boolean
}

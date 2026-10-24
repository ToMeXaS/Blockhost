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
  /** Soft cap on the server folder's size; starting is refused at or above it. */
  diskLimitMb?: number
  port: number
  javaPath?: string
  jvmArgs: string[]
  launch?: LaunchSpec
  installState: InstallState
  createdAt: string
  tunnel?: ServerTunnel
  /** Absent means automatic backups are off and the last 10 are kept. */
  backup?: BackupSettings
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
  /** `null` removes the limit. */
  diskLimitMb?: number | null
  /** `null` switches back to the automatically managed Java. */
  javaPath?: string | null
  jvmArgs?: string[]
  backup?: BackupSettings
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
  /** False in dev builds, where nothing can be checked or installed. */
  enabled: boolean
  /** Check, download and install in the background. */
  auto: boolean
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
  /** Online player name → epoch ms they joined (or were first seen). */
  onlineSince: Record<string, number>
  /** Online player name → dimension id (e.g. "minecraft:the_nether"), once known. */
  dimensions: Record<string, string>
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

export type WorldDimension = 'overworld' | 'nether' | 'end'

export interface WorldInfo {
  dimension: WorldDimension
  /** Where it lives, relative to the server folder: "world", "world_nether" or "world/DIM-1". */
  folder: string
  bytes: number
  /** Generated chunks, from the region files' location tables. */
  chunks: number
}

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

export const CONTENT_SOURCES = ['modrinth', 'hangar', 'spigot'] as const
export type ContentSource = (typeof CONTENT_SOURCES)[number]

export const CONTENT_SOURCE_LABELS: Record<ContentSource, string> = {
  modrinth: 'Modrinth',
  hangar: 'Hangar',
  spigot: 'SpigotMC'
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

/** One performance reading for a running server. `null` means "no reading". */
export interface StatsPoint {
  at: number
  /** Percent of the whole machine's CPU, 0–100. */
  cpu: number | null
  /** Memory in use by the Java process (working set). */
  memBytes: number | null
  tps: number | null
}

export interface StatsSnapshot {
  points: StatsPoint[]
  allocatedMb: number
  cores: number
  tpsSupported: boolean
  samplerAvailable: boolean
}

export interface DiskUsage {
  /** Size of the server's folder. */
  serverBytes: number
  freeBytes: number
  totalBytes: number
  /** "C:" on Windows, "/" elsewhere. */
  drive: string
  /** Total size of this server's backups; absent when unknown. */
  backupsBytes?: number
}

export interface StatsSampleEvent {
  serverId: string
  point: StatsPoint
  samplerAvailable: boolean
}

export type BackupKind = 'manual' | 'auto' | 'pre-restore'

/** Hours between automatic backups that the UI offers. */
export const BACKUP_INTERVALS = [1, 3, 6, 12, 24] as const

export interface BackupSettings {
  /** `null` turns automatic backups off. */
  intervalHours: number | null
  /** How many automatic backups to keep; manual ones are never pruned. */
  keep: number
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { intervalHours: null, keep: 10 }

export interface BackupInfo {
  /** File name inside the server's backup folder. */
  file: string
  kind: BackupKind
  createdAt: string
  bytes: number
}

export interface BackupFailure {
  at: string
  message: string
}

export interface BackupList {
  items: BackupInfo[]
  /** The last automatic backup's error, cleared by the next successful one. */
  lastAutoFailure: BackupFailure | null
}

export type BackupServerMeta = Pick<
  ServerRecord,
  'name' | 'type' | 'mcVersion' | 'build' | 'ramMb' | 'jvmArgs' | 'launch' | 'port'
>

/** Stored as blockhost-backup.json inside every zip Blockhost makes. */
export interface BackupMeta {
  version: 1
  createdAt: string
  kind: BackupKind
  server: BackupServerMeta
}

export interface BackupProgress {
  serverId: string
  op: 'backup' | 'restore'
  percent: number
}

export interface BackupsChangedEvent {
  serverId: string
}

export interface RestoreAsNewInput {
  name: string
  dir: string
  port: number
}

export interface BackupLocation {
  dir: string
  isDefault: boolean
}

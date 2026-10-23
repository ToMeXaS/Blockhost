import type {
  BackupList,
  ServerStatus,
  ServerType,
  ServerView,
  WorldDimension
} from '../../../shared/types'

export const STATUS_LABEL: Record<ServerStatus, string> = {
  stopped: 'Stopped',
  starting: 'Starting…',
  running: 'Running',
  stopping: 'Stopping…',
  crashed: 'Crashed'
}

export const STATUS_DOT: Record<ServerStatus, string> = {
  stopped: 'bg-faint',
  starting: 'bg-warn animate-pulse',
  running: 'bg-accent',
  stopping: 'bg-warn animate-pulse',
  crashed: 'bg-danger'
}

export const TYPE_BLURB: Record<ServerType, string> = {
  vanilla: 'The official server from Mojang. No plugins or mods.',
  paper: 'Fast and stable, runs Bukkit/Spigot plugins. The best default.',
  purpur: 'Paper with extra gameplay options and tweaks.',
  fabric: 'Lightweight mod loader for modern mods.',
  forge: 'The classic mod loader with the largest mod library.',
  neoforge: 'Modern fork of Forge used by most new mods.'
}

export function formatRam(mb: number): string {
  return mb % 1024 === 0 ? `${mb / 1024} GB` : `${(mb / 1024).toFixed(1)} GB`
}

/** "512 B", "2 KB", "1.8 GB", "212 GB": one decimal below 10, whole numbers above. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const text =
    value < 10 && unit > 0 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value))
  return `${text} ${units[unit]}`
}

/** How full a bar is: warn above 90%, over at 100%. */
export function fillLevel(ratio: number): 'ok' | 'warn' | 'over' {
  if (ratio >= 1) return 'over'
  return ratio > 0.9 ? 'warn' : 'ok'
}

/** A quarter of system RAM, rounded to 512 MB, between 1 GB and 8 GB. */
export function defaultRamMb(totalMb: number): number {
  const quarter = Math.round((totalMb * 0.25) / 512) * 512
  return Math.min(8192, Math.max(1024, quarter))
}

/** Leaves 2 GB for Windows, capped at 32 GB. */
export function maxRamMb(totalMb: number): number {
  return Math.max(1024, Math.min(32768, Math.floor((totalMb - 2048) / 512) * 512))
}

/** "45s", "2m 5s", "1h 2m", "1d 1h". */
export function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

/** How long a player has been online: "<1m", "48m", "2h 41m", "1d 3h". */
export function formatSession(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export const DIMENSION_LABEL: Record<WorldDimension, string> = {
  overworld: 'Overworld',
  nether: 'Nether',
  end: 'The End'
}

const DIMENSION_IDS: Record<string, WorldDimension> = {
  'minecraft:overworld': 'overworld',
  'minecraft:the_nether': 'nether',
  'minecraft:the_end': 'end'
}

/** The vanilla dimension a dimension id refers to; null for modded dimensions. */
export function dimensionOf(id: string | undefined): WorldDimension | null {
  return (id && DIMENSION_IDS[id]) || null
}

export const AVATAR_COLORS = [
  '#6FA8F5',
  '#F2B84B',
  '#C792EA',
  '#8BE36B',
  '#F2958A',
  '#5FD3C6'
] as const

/** A stable colour for a player's letter avatar. */
export function avatarColor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!
}

/** The address players use: the playit address when shared, otherwise localhost. */
export function serverAddress(server: Pick<ServerView, 'port' | 'tunnel'>): string {
  const tunnel = server.tunnel
  return tunnel?.enabled && tunnel.address ? tunnel.address : `localhost:${server.port}`
}

export function javaLabel(javaPath?: string): string {
  if (!javaPath) return 'Java auto'
  return javaPath.split(/[\\/]/).pop() || javaPath
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function formatAgo(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

const HOUR_MS = 3_600_000

/** The sidebar's one-line backup status: the next automatic one, else the last one. */
export function backupHint(
  list: BackupList,
  intervalHours: number | null,
  running: boolean,
  nowMs: number
): { text: string; warn: boolean } {
  if (list.lastAutoFailure) return { text: 'Last automatic backup failed', warn: true }
  if (intervalHours && running) {
    const lastAuto = list.items.find((b) => b.kind === 'auto')
    const dueIn = lastAuto ? Date.parse(lastAuto.createdAt) + intervalHours * HOUR_MS - nowMs : 0
    return {
      text: dueIn < 60_000 ? 'Next backup soon' : `Next backup in ${formatSession(dueIn)}`,
      warn: false
    }
  }
  const last = list.items[0]
  return {
    text: last ? `Last backup ${formatAgo(nowMs - Date.parse(last.createdAt))}` : 'No backups yet',
    warn: false
  }
}

import type { ServerStatus, ServerType, ServerView } from '../../../shared/types'

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

import type { ServerStatus, ServerType } from '../../../shared/types'

export const STATUS_LABEL: Record<ServerStatus, string> = {
  stopped: 'Stopped',
  starting: 'Starting…',
  running: 'Running',
  stopping: 'Stopping…',
  crashed: 'Crashed'
}

export const STATUS_DOT: Record<ServerStatus, string> = {
  stopped: 'bg-zinc-500',
  starting: 'bg-amber-400 animate-pulse',
  running: 'bg-emerald-400',
  stopping: 'bg-amber-400 animate-pulse',
  crashed: 'bg-red-500'
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

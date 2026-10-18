import type { ServerStatus } from '../../../shared/types'

/** Updates the map of server id → time it was first seen running. */
export function nextRunningSince(
  prev: Record<string, number>,
  serverId: string,
  status: ServerStatus,
  now: number
): Record<string, number> {
  if (status === 'running') {
    return prev[serverId] === undefined ? { ...prev, [serverId]: now } : prev
  }
  if (prev[serverId] === undefined) return prev
  const next = { ...prev }
  delete next[serverId]
  return next
}

import { useEffect, useState } from 'react'
import type { ServerStatus, StatsPoint } from '../../../shared/types'
import { api } from '../lib/api'
import { appendPoint, mergePoints } from '../lib/stats'

export interface ServerStats {
  /** False until the first snapshot arrives for a running server. */
  loaded: boolean
  points: StatsPoint[]
  allocatedMb: number
  cores: number
  tpsSupported: boolean
  samplerAvailable: boolean
}

const EMPTY: ServerStats = {
  loaded: false,
  points: [],
  allocatedMb: 0,
  cores: 0,
  tpsSupported: false,
  samplerAvailable: true
}

/** Last hour of performance points for a running server, kept up to date. */
export function useServerStats(serverId: string, status: ServerStatus): ServerStats {
  const [stats, setStats] = useState<ServerStats>(EMPTY)

  useEffect(() => {
    setStats(EMPTY)
    if (status !== 'running') return
    let alive = true
    const off = api.on('stats:sample', (event) => {
      if (event.serverId !== serverId) return
      setStats((prev) => ({
        ...prev,
        samplerAvailable: event.samplerAvailable,
        points: appendPoint(prev.points, event.point)
      }))
    })
    api
      .statsGet(serverId)
      .then((snap) => {
        if (!alive) return
        setStats((prev) => ({
          ...snap,
          loaded: true,
          points: mergePoints(snap.points, prev.points)
        }))
      })
      .catch(() => {})
    return () => {
      alive = false
      off()
    }
  }, [serverId, status])

  return stats
}

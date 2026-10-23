import { useEffect, useState } from 'react'
import type { DiskUsage } from '../../../shared/types'
import { api } from '../lib/api'

const REFRESH_MS = 60_000

/** Server folder size and drive space, refreshed every minute. Null until known or on failure. */
export function useDiskUsage(serverId: string | undefined): DiskUsage | null {
  const [usage, setUsage] = useState<DiskUsage | null>(null)

  useEffect(() => {
    setUsage(null)
    if (!serverId) return
    let alive = true
    const load = (): void => {
      api
        .diskGet(serverId)
        .then((next) => {
          if (alive) setUsage(next)
        })
        .catch(() => {})
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [serverId])

  return usage
}

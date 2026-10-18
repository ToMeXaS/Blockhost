import { useEffect, useState } from 'react'
import { api } from '../lib/api'

/** The last `max` console lines of a server, kept up to date. */
export function useLogTail(serverId: string, max: number): string[] {
  const [lines, setLines] = useState<string[]>([])

  useEffect(() => {
    // Events that arrive before the backfill are already contained in it, so they are dropped.
    let ready = false
    let alive = true
    setLines([])
    const off = api.on('server:log', (event) => {
      if (!ready || event.serverId !== serverId) return
      setLines((prev) => prev.concat(event.lines).slice(-max))
    })
    api
      .getLog(serverId)
      .then((log) => {
        if (alive) setLines(log.slice(-max))
      })
      .catch(() => {})
      .finally(() => {
        ready = true
      })
    return () => {
      alive = false
      off()
    }
  }, [serverId, max])

  return lines
}

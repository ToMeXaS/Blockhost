import { useEffect, useState } from 'react'
import type { ServerStatus } from '../../../shared/types'
import { api } from '../lib/api'

/** Names of the players online on a running server, kept up to date. */
export function useOnlinePlayers(
  serverId: string | undefined,
  status: ServerStatus | undefined
): string[] {
  const [online, setOnline] = useState<string[]>([])

  useEffect(() => {
    setOnline([])
    if (!serverId || status !== 'running') return
    let alive = true
    const load = () =>
      api
        .getPlayers(serverId)
        .then((lists) => {
          if (alive) setOnline(lists.online)
        })
        .catch(() => {})
    void load()
    const off = api.on('players:changed', (event) => {
      if (event.serverId === serverId) void load()
    })
    return () => {
      alive = false
      off()
    }
  }, [serverId, status])

  return online
}

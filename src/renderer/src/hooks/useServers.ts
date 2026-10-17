import { useCallback, useEffect, useState } from 'react'
import type { ServerView } from '../../../shared/types'
import { api, errorMessage } from '../lib/api'

export function useServers() {
  const [servers, setServers] = useState<ServerView[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setServers(await api.listServers())
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const offStatus = api.on('server:status', (event) =>
      setServers((list) =>
        list.map((s) => (s.id === event.serverId ? { ...s, status: event.status } : s))
      )
    )
    const offInstall = api.on('install:progress', (event) => {
      if (event.step === 'done' || event.step === 'error') void refresh()
    })
    return () => {
      offStatus()
      offInstall()
    }
  }, [refresh])

  return { servers, loaded, error, refresh }
}

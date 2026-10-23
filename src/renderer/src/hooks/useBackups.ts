import { useCallback, useEffect, useState } from 'react'
import type { BackupList, BackupProgress } from '../../../shared/types'
import { api, errorMessage } from '../lib/api'

/** A server's backups, refreshed when the main process says they changed, plus live progress. */
export function useBackups(serverId: string): {
  list: BackupList | null
  progress: BackupProgress | null
  error: string | null
  refresh: () => void
  clearProgress: () => void
} {
  const [list, setList] = useState<BackupList | null>(null)
  const [progress, setProgress] = useState<BackupProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api
      .backupsList(serverId)
      .then((next) => {
        setList(next)
        setError(null)
      })
      .catch((err) => setError(errorMessage(err)))
  }, [serverId])

  const clearProgress = useCallback(() => setProgress(null), [])

  useEffect(() => {
    setList(null)
    setProgress(null)
    refresh()
    const offChanged = api.on('backups:changed', (event) => {
      if (event.serverId !== serverId) return
      setProgress(null)
      refresh()
    })
    const offProgress = api.on('backup:progress', (event) => {
      if (event.serverId === serverId) setProgress(event.percent >= 100 ? null : event)
    })
    return () => {
      offChanged()
      offProgress()
    }
  }, [serverId, refresh])

  return { list, progress, error, refresh, clearProgress }
}

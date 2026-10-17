import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/types'
import { api, errorMessage } from '../lib/api'
import { Button } from './ui'

/** Current update status, kept in sync with the main process. */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    let mounted = true
    void api.getUpdateStatus().then((s) => {
      if (mounted) setStatus(s)
    })
    const off = api.on('update:status', (s) => setStatus(s))
    return () => {
      mounted = false
      off()
    }
  }, [])

  return status
}

export function UpdateBanner() {
  const status = useUpdateStatus()
  const [dismissed, setDismissed] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)

  useEffect(() => {
    setDismissed(false)
  }, [status?.state])

  if (!status || dismissed) return null

  const install = () => {
    setInstallError(null)
    api.installUpdate().catch((err: unknown) => setInstallError(errorMessage(err)))
  }

  if (status.state === 'available') {
    return (
      <div className="border-b border-emerald-900 bg-emerald-950/60 px-6 py-2 text-sm text-emerald-200">
        Update v{status.version} found, downloading…
      </div>
    )
  }

  if (status.state === 'downloading') {
    return (
      <div className="border-b border-emerald-900 bg-emerald-950/60 px-6 py-2 text-sm text-emerald-200">
        Downloading update v{status.version}… {status.percent ?? 0}%
      </div>
    )
  }

  if (status.state === 'ready') {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-emerald-900 bg-emerald-950/60 px-6 py-2 text-sm text-emerald-200">
        <span>
          Update v{status.version} is ready.
          {installError && <span className="ml-2 text-red-300">{installError}</span>}
        </span>
        <Button variant="primary" onClick={install}>
          Restart to update
        </Button>
      </div>
    )
  }

  if (status.state === 'error') {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900/60 px-6 py-2 text-sm text-zinc-300">
        <span>Couldn&apos;t check for updates: {status.message}</span>
        <Button variant="ghost" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </div>
    )
  }

  return null
}

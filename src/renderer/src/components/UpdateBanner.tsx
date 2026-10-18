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
    api
      .installUpdate()
      .catch((err: unknown) => setInstallError(errorMessage(err).split('\n')[0]!.slice(0, 200)))
  }

  if (status.state === 'available') {
    return (
      <div className="space-y-2 rounded-btn border border-ok-border bg-ok-bg px-3 py-2.5 text-xs text-ok-text">
        Update v{status.version} found, downloading…
      </div>
    )
  }

  if (status.state === 'downloading') {
    return (
      <div className="space-y-2 rounded-btn border border-ok-border bg-ok-bg px-3 py-2.5 text-xs text-ok-text">
        Downloading update v{status.version}… {status.percent ?? 0}%
      </div>
    )
  }

  if (status.state === 'ready') {
    return (
      <div className="space-y-2 rounded-btn border border-ok-border bg-ok-bg px-3 py-2.5 text-xs text-ok-text">
        <span>
          Update v{status.version} is ready.
          {installError && <span className="ml-2 text-danger">{installError}</span>}
        </span>
        <Button size="sm" variant="primary" className="w-full" onClick={install}>
          Restart to update
        </Button>
      </div>
    )
  }

  if (status.state === 'error') {
    const message = (status.message ?? '').split('\n')[0]!.slice(0, 200)
    return (
      <div className="space-y-2 rounded-btn border border-border-strong bg-panel px-3 py-2.5 text-xs text-muted">
        <span>Couldn&apos;t check for updates: {message}</span>
        <Button size="sm" variant="ghost" className="w-full" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </div>
    )
  }

  return null
}

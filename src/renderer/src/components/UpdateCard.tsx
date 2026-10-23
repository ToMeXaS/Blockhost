import { useEffect, useState, type ReactNode } from 'react'
import type { UpdateStatus } from '../../../shared/types'
import { api, errorMessage } from '../lib/api'
import { CheckIcon, MoreIcon, RestartIcon } from './icons'
import { useToast } from './Toaster'
import { Button, Menu, type MenuEntry } from './ui'

/** How long "You're up to date" stays after a manual check. */
const UP_TO_DATE_MS = 4000

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

function firstLine(text: string): string {
  return text.split('\n')[0]!.slice(0, 200)
}

function install(onError: (message: string) => void) {
  api.installUpdate().catch((err: unknown) => onError(firstLine(errorMessage(err))))
}

function Progress({ percent }: { percent: number }) {
  const value = Math.max(0, Math.min(100, percent))
  return (
    <div
      role="progressbar"
      aria-label="Update download"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="h-1.5 overflow-hidden rounded-full bg-panel-2"
    >
      <span
        className="block h-full rounded-full bg-accent transition-[width] duration-300"
        style={{ width: `${value}%` }}
      />
    </div>
  )
}

/** Sidebar footer card: app version, update progress, and the update options menu. */
export function UpdateCard() {
  const status = useUpdateStatus()
  // Once dismissed, periodic re-checks don't keep reviving the error; a manual check does.
  const [errorDismissed, setErrorDismissed] = useState(false)
  const [upToDate, setUpToDate] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!upToDate) return
    const timer = setTimeout(() => setUpToDate(false), UP_TO_DATE_MS)
    return () => clearTimeout(timer)
  }, [upToDate])

  if (!status) return null
  const { state, auto, enabled } = status
  const busy = state === 'checking' || state === 'downloading' || state === 'ready'

  const check = () => {
    setErrorDismissed(false)
    setUpToDate(false)
    setActionError(null)
    api
      .checkForUpdates()
      .then((s) => setUpToDate(s.state === 'idle'))
      .catch((err: unknown) => setActionError(firstLine(errorMessage(err))))
  }
  const toggleAuto = () => {
    setActionError(null)
    api.setAutoUpdate(!auto).catch((err: unknown) => setActionError(firstLine(errorMessage(err))))
  }
  const download = () => {
    setActionError(null)
    api.downloadUpdate().catch((err: unknown) => setActionError(firstLine(errorMessage(err))))
  }

  const menu: MenuEntry[] = [
    {
      label: 'Check for updates',
      icon: <RestartIcon />,
      hint: !enabled ? 'Only in the installed app' : undefined,
      disabled: !enabled || busy,
      onSelect: check
    },
    {
      label: 'Automatic updates',
      icon: auto ? <CheckIcon /> : <span />,
      hint: auto ? 'On · downloads in the background' : 'Off · check by hand',
      selected: auto,
      onSelect: toggleAuto
    }
  ]

  const showError = state === 'error' && !errorDismissed
  const incoming = state === 'available' || state === 'downloading' || state === 'ready'

  let title: ReactNode = 'Blockhost'
  let body: ReactNode = null
  if (state === 'checking') {
    title = 'Checking…'
  } else if (state === 'available' && !auto) {
    title = 'Update available'
    body = (
      <Button size="sm" className="w-full" onClick={download}>
        Download update
      </Button>
    )
  } else if (state === 'available' || state === 'downloading') {
    const percent = status.percent ?? 0
    title = 'Downloading update'
    body = (
      <>
        <Progress percent={percent} />
        <div className="flex justify-between font-mono text-[11px] text-faint">
          <span>from v{status.currentVersion}</span>
          <span>{percent}%</span>
        </div>
      </>
    )
  } else if (state === 'ready') {
    title = (
      <>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
        <span className="text-text">Update ready</span>
      </>
    )
    body = (
      <>
        <Button
          size="sm"
          variant="primary"
          className="w-full"
          onClick={() => install(setActionError)}
        >
          Restart to update
        </Button>
        <div className="text-[11px] text-faint">Servers are stopped safely first.</div>
      </>
    )
  } else if (showError) {
    body = (
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-warn" title={firstLine(status.message ?? '')}>
          Update check failed
        </span>
        <button
          type="button"
          onClick={() => setErrorDismissed(true)}
          className="shrink-0 text-faint transition-colors hover:text-text"
        >
          Dismiss
        </button>
      </div>
    )
  } else if (upToDate) {
    body = <div className="text-muted">You&apos;re up to date.</div>
  } else if (enabled && !auto) {
    body = <div className="text-faint">Automatic updates are off.</div>
  }

  return (
    <div className="space-y-2.5 rounded-card border border-border bg-panel px-3.5 py-3 text-[12px]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-muted">{title}</span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="font-mono text-text">
            v{incoming && status.version ? status.version : status.currentVersion}
          </span>
          <Menu
            label="Update options"
            align="right"
            items={menu}
            buttonClassName="-mr-1.5 inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted transition-colors hover:bg-panel-2 hover:text-text"
            button={<MoreIcon className="h-4 w-4" />}
          />
        </span>
      </div>
      {body}
      {actionError && <div className="text-danger">{actionError}</div>}
    </div>
  )
}

/** For the collapsed sidebar, where the card doesn't fit: shown only once an update is ready. */
export function UpdateReadyButton() {
  const status = useUpdateStatus()
  const toast = useToast()
  if (status?.state !== 'ready') return null
  return (
    <button
      type="button"
      title={`Restart to install v${status.version}`}
      aria-label={`Restart to install update v${status.version}`}
      onClick={() => install(toast.error)}
      className="relative flex h-10 w-full items-center justify-center rounded-btn text-accent transition-colors hover:bg-panel"
    >
      <RestartIcon className="h-[18px] w-[18px]" />
      <span className="absolute right-2.5 top-2 h-1.5 w-1.5 rounded-full bg-accent" />
    </button>
  )
}

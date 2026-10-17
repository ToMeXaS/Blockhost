import { useEffect, useState } from 'react'
import type { ServerView } from '../../../shared/types'
import { InstallPanel } from '../components/InstallPanel'
import { Button, ErrorText, StatusBadge, TypeBadge } from '../components/ui'
import { api, ApiCallError, errorMessage } from '../lib/api'
import { ConnectTab } from './tabs/ConnectTab'
import { ConsoleTab } from './tabs/ConsoleTab'
import { PropertiesTab } from './tabs/PropertiesTab'
import { SettingsTab } from './tabs/SettingsTab'

type Tab = 'console' | 'properties' | 'settings' | 'connect'

const TABS: { id: Tab; label: string }[] = [
  { id: 'console', label: 'Console' },
  { id: 'properties', label: 'Properties' },
  { id: 'settings', label: 'Settings' },
  { id: 'connect', label: 'Connect' }
]

const FORCE_KILL_AFTER_MS = 30_000

interface Props {
  server: ServerView
  onBack: () => void
  onChanged: () => void
  onDeleted: () => void
}

export function ServerDetail({ server, onBack, onChanged, onDeleted }: Props) {
  const [tab, setTab] = useState<Tab>('console')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missingJava, setMissingJava] = useState<number | null>(null)
  const [showKill, setShowKill] = useState(false)

  useEffect(() => {
    setShowKill(false)
    if (server.status !== 'stopping') return
    const timer = setTimeout(() => setShowKill(true), FORCE_KILL_AFTER_MS)
    return () => clearTimeout(timer)
  }, [server.status])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setMissingJava(null)
    try {
      await action()
    } catch (err) {
      const major =
        err instanceof ApiCallError && err.code === 'JAVA_MISSING' ? err.details?.major : undefined
      if (typeof major === 'number') setMissingJava(major)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const ready = server.installState === 'ready'
  const up = server.status === 'starting' || server.status === 'running'

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-6 py-4">
        <Button variant="ghost" onClick={onBack}>
          ← Servers
        </Button>
        <h1 className="text-lg font-semibold">{server.name}</h1>
        <TypeBadge server={server} />
        {ready && <StatusBadge status={server.status} />}
        <div className="ml-auto flex gap-2">
          {ready && !up && server.status !== 'stopping' && (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void run(() => api.start(server.id))}
            >
              Start
            </Button>
          )}
          {up && (
            <>
              <Button disabled={busy} onClick={() => void run(() => api.stop(server.id))}>
                Stop
              </Button>
              <Button
                disabled={busy || server.status !== 'running'}
                onClick={() => void run(() => api.restart(server.id))}
              >
                Restart
              </Button>
            </>
          )}
          {server.status === 'stopping' && showKill && (
            <Button variant="danger" onClick={() => void run(() => api.kill(server.id))}>
              Force kill
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="space-y-2 px-6 pt-4">
          <ErrorText>{error}</ErrorText>
          {missingJava !== null && (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.installJava(missingJava)
                  await api.start(server.id)
                })
              }
            >
              {busy ? `Installing Java ${missingJava}…` : `Install Java ${missingJava} and start`}
            </Button>
          )}
        </div>
      )}

      {!ready ? (
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <InstallPanel
            key={server.installState}
            serverId={server.id}
            initialState={server.installState}
            actions={(state) =>
              state === 'error' ? (
                <>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.retryInstall(server.id)
                        onChanged()
                      })
                    }
                  >
                    Retry install
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.removeServer(server.id, false)
                        onDeleted()
                      })
                    }
                  >
                    Delete
                  </Button>
                </>
              ) : null
            }
          />
        </div>
      ) : (
        <>
          <nav className="flex gap-1 border-b border-zinc-800 px-6">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`border-b-2 px-3 py-2 text-sm ${
                  tab === t.id
                    ? 'border-emerald-500 text-zinc-100'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div
            className={`min-h-0 flex-1 p-6 ${tab === 'console' ? 'overflow-hidden' : 'overflow-auto'}`}
          >
            {tab === 'console' && <ConsoleTab server={server} />}
            {tab === 'properties' && <PropertiesTab server={server} onChanged={onChanged} />}
            {tab === 'settings' && (
              <SettingsTab server={server} onChanged={onChanged} onDeleted={onDeleted} />
            )}
            {tab === 'connect' && <ConnectTab server={server} />}
          </div>
        </>
      )}
    </div>
  )
}

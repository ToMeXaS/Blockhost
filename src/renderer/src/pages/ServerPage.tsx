import { useEffect, useState } from 'react'
import { SERVER_TYPE_LABELS, type ServerView } from '../../../shared/types'
import { InstallPanel } from '../components/InstallPanel'
import { CopyIcon, MoreIcon } from '../components/icons'
import { Badge, Button, ErrorText, Menu, pageClass, StatusPill } from '../components/ui'
import { useCopy } from '../hooks/useCopy'
import { api, ApiCallError, errorMessage } from '../lib/api'
import { formatRam, javaLabel, serverAddress } from '../lib/format'
import type { Section } from '../lib/routes'
import { ConnectSection } from './sections/ConnectSection'
import { ConsoleSection } from './sections/ConsoleSection'
import { ContentSection } from './sections/ContentSection'
import { OverviewSection } from './sections/OverviewSection'
import { PlayersSection } from './sections/PlayersSection'
import { PropertiesSection } from './sections/PropertiesSection'
import { SettingsSection } from './sections/SettingsSection'

const FORCE_KILL_AFTER_MS = 30_000

interface Props {
  server: ServerView
  section: Section
  online: string[]
  runningSince?: number
  onSection: (section: Section) => void
  onChanged: () => void
  onDeleted: () => void
}

export function ServerPage(props: Props) {
  const { server, section, online, runningSince, onSection, onChanged, onDeleted } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missingJava, setMissingJava] = useState<number | null>(null)
  const [showKill, setShowKill] = useState(false)
  const { copied, copy } = useCopy()

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
  const address = serverAddress(server)
  const isConsole = ready && section === 'console'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`${pageClass} space-y-4 pb-0`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="truncate text-[26px] font-bold leading-tight tracking-tight">
                {server.name}
              </h1>
              {ready ? (
                <StatusPill status={server.status} />
              ) : (
                <Badge tone={server.installState === 'failed' ? 'danger' : 'warn'}>
                  {server.installState === 'failed' ? 'Install failed' : 'Installing…'}
                </Badge>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[13px] text-muted">
              <button
                type="button"
                title="Copy address"
                onClick={() => copy(address)}
                className="inline-flex items-center gap-1.5 text-text-2 transition-colors hover:text-text"
              >
                <CopyIcon className="h-3.5 w-3.5" />
                {copied ? 'Copied' : address}
              </button>
              <span className="text-faint">·</span>
              <span>
                {SERVER_TYPE_LABELS[server.type]} {server.mcVersion}
              </span>
              <span className="text-faint">·</span>
              <span>{javaLabel(server.javaPath)}</span>
              <span className="text-faint">·</span>
              <span>{formatRam(server.ramMb)}</span>
            </div>
          </div>

          {ready && (
            <div className="flex items-center gap-2">
              {!up && server.status !== 'stopping' && (
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
                  <Button
                    disabled={busy || server.status !== 'running'}
                    onClick={() => void run(() => api.restart(server.id))}
                  >
                    Restart
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void run(() => api.stop(server.id))}
                  >
                    Stop
                  </Button>
                </>
              )}
              {server.status === 'stopping' && (
                <Button variant="danger" disabled>
                  Stopping…
                </Button>
              )}
              <Menu
                label="More actions"
                align="right"
                buttonClassName="inline-flex h-9 w-9 items-center justify-center rounded-btn border border-border-strong bg-panel-2 text-text-2 transition-colors hover:bg-nav-active"
                button={<MoreIcon className="h-4 w-4" />}
                items={[
                  {
                    label: 'Force kill',
                    hint: 'Available after 30 s of stopping',
                    danger: true,
                    disabled: !(server.status === 'stopping' && showKill),
                    onSelect: () => void run(() => api.kill(server.id))
                  }
                ]}
              />
            </div>
          )}
        </div>

        {error && (
          <div className="space-y-2">
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
      </div>

      <div className={`min-h-0 flex-1 ${isConsole ? 'overflow-hidden' : 'overflow-auto'}`}>
        <div className={`${pageClass} pt-6 ${isConsole ? 'h-full' : ''}`}>
          {!ready ? (
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
          ) : (
            <>
              {section === 'overview' && (
                <OverviewSection
                  server={server}
                  online={online}
                  runningSince={runningSince}
                  onSection={onSection}
                />
              )}
              {section === 'console' && <ConsoleSection server={server} />}
              {section === 'players' && <PlayersSection server={server} />}
              {section === 'content' && <ContentSection server={server} />}
              {section === 'properties' && (
                <PropertiesSection server={server} onChanged={onChanged} />
              )}
              {section === 'settings' && (
                <SettingsSection server={server} onChanged={onChanged} onDeleted={onDeleted} />
              )}
              {section === 'connect' && <ConnectSection server={server} onChanged={onChanged} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

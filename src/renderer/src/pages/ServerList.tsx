import { useState } from 'react'
import { SERVER_TYPE_LABELS, type ServerView } from '../../../shared/types'
import { Logo, PlusIcon } from '../components/icons'
import { Badge, Button, ErrorText, pageClass, StatusPill } from '../components/ui'
import { useOnlinePlayers } from '../hooks/useOnlinePlayers'
import { api, errorMessage } from '../lib/api'
import { formatRam } from '../lib/format'

interface Props {
  servers: ServerView[]
  loaded: boolean
  onOpen: (id: string) => void
  onNew: () => void
}

const isUp = (s: ServerView): boolean => s.status === 'running' || s.status === 'starting'

function ServerCard({
  server,
  busy,
  onOpen,
  onToggle
}: {
  server: ServerView
  busy: boolean
  onOpen: () => void
  onToggle: () => void
}) {
  const online = useOnlinePlayers(server.id, server.status)
  const ready = server.installState === 'ready'
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      className="cursor-pointer space-y-4 rounded-card border border-border bg-panel p-5 transition-colors hover:border-border-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold">{server.name}</h2>
          <p className="mt-0.5 font-mono text-xs text-muted">
            {SERVER_TYPE_LABELS[server.type]} {server.mcVersion}
          </p>
        </div>
        {ready ? (
          <StatusPill status={server.status} />
        ) : (
          <Badge tone={server.installState === 'failed' ? 'danger' : 'warn'}>
            {server.installState === 'installing' ? 'Installing…' : 'Install failed'}
          </Badge>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-faint">
          :{server.port} · {formatRam(server.ramMb)}
          {server.status === 'running' && ` · ${online.length} online`}
        </p>
        {ready && (
          <Button
            size="sm"
            variant={isUp(server) ? 'danger' : 'primary'}
            disabled={busy || server.status === 'stopping'}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            {isUp(server) ? 'Stop' : 'Start'}
          </Button>
        )}
      </div>
    </div>
  )
}

export function ServerList({ servers, loaded, onOpen, onNew }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(server: ServerView) {
    setBusyId(server.id)
    setError(null)
    try {
      if (isUp(server)) await api.stop(server.id)
      else await api.start(server.id)
    } catch (err) {
      setError(`${server.name}: ${errorMessage(err)}`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className={`${pageClass} space-y-6`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Servers</h1>
          <p className="mt-1 text-sm text-muted">
            Every Minecraft server Blockhost runs on this PC.
          </p>
        </div>
        <Button variant="primary" onClick={onNew}>
          <PlusIcon className="h-4 w-4" />
          New server
        </Button>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loaded && servers.length === 0 && (
        <div className="mx-auto max-w-md space-y-4 rounded-card border border-border bg-panel p-10 text-center">
          <Logo className="mx-auto h-10 w-10" />
          <p className="text-sm text-muted">No servers yet. Create one in a few clicks.</p>
          <Button variant="primary" onClick={onNew}>
            Create your first server
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {servers.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            busy={busyId === server.id}
            onOpen={() => onOpen(server.id)}
            onToggle={() => void toggle(server)}
          />
        ))}
      </div>
    </div>
  )
}

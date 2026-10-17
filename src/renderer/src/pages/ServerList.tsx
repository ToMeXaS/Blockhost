import { useState } from 'react'
import type { ServerView } from '../../../shared/types'
import { Button, ErrorText, StatusBadge, TypeBadge } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { formatRam } from '../lib/format'

interface Props {
  servers: ServerView[]
  loaded: boolean
  onOpen: (id: string) => void
  onNew: () => void
}

const isUp = (s: ServerView): boolean => s.status === 'running' || s.status === 'starting'

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
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Your servers</h1>
        <Button variant="primary" onClick={onNew}>
          + New server
        </Button>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loaded && servers.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-700 p-10 text-center text-zinc-400">
          <p className="mb-4">No servers yet. Create one in a few clicks.</p>
          <Button variant="primary" onClick={onNew}>
            Create your first server
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {servers.map((server) => (
          <div
            key={server.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(server.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onOpen(server.id)
            }}
            className="cursor-pointer space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-600"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="truncate font-medium">{server.name}</h2>
              <TypeBadge server={server} />
            </div>
            <div className="flex items-center justify-between">
              {server.installState === 'ready' ? (
                <StatusBadge status={server.status} />
              ) : (
                <span className="text-sm text-zinc-400">
                  {server.installState === 'installing' ? 'Installing…' : 'Install failed'}
                </span>
              )}
              {server.installState === 'ready' && (
                <Button
                  disabled={busyId === server.id || server.status === 'stopping'}
                  onClick={(e) => {
                    e.stopPropagation()
                    void toggle(server)
                  }}
                >
                  {isUp(server) ? 'Stop' : 'Start'}
                </Button>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              Port {server.port} · {formatRam(server.ramMb)} RAM
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

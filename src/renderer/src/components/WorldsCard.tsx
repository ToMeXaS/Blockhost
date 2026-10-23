import { type ReactNode, useEffect, useState } from 'react'
import type { ServerView, WorldDimension, WorldInfo } from '../../../shared/types'
import { api } from '../lib/api'
import { DIMENSION_LABEL, dimensionOf, formatBytes } from '../lib/format'
import { Card } from './ui'

const SCAN_INTERVAL_MS = 60_000
/** Re-asks where players are; the main process throttles the actual commands. */
const DIMENSION_POLL_MS = 15_000

const SWATCH: Record<WorldDimension, string> = {
  overworld: 'linear-gradient(135deg, #4c9a3c 50%, #6b4a2b 50%)',
  nether: 'linear-gradient(135deg, #a3302c 50%, #5a1f1f 50%)',
  end: 'linear-gradient(135deg, #e6e2a8 50%, #3d2d55 50%)'
}

/** The server's dimensions with their size, generated chunks and who is in each. */
export function WorldsCard({
  server,
  footer,
  className = ''
}: {
  server: ServerView
  footer?: ReactNode
  className?: string
}) {
  const [worlds, setWorlds] = useState<WorldInfo[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [dimensions, setDimensions] = useState<Record<string, string>>({})
  const running = server.status === 'running'

  useEffect(() => {
    let alive = true
    const scan = () =>
      api
        .worldsGet(server.id)
        .then((list) => {
          if (!alive) return
          setWorlds(list)
          setFailed(false)
        })
        .catch(() => {
          if (alive) setFailed(true)
        })
    void scan()
    const timer = running ? setInterval(() => void scan(), SCAN_INTERVAL_MS) : undefined
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [server.id, running])

  useEffect(() => {
    setDimensions({})
    if (!running) return
    let alive = true
    const load = () =>
      api
        .getPlayers(server.id)
        .then((lists) => {
          if (alive) setDimensions(lists.dimensions)
        })
        .catch(() => {})
    void load()
    const timer = setInterval(() => void load(), DIMENSION_POLL_MS)
    const off = api.on('players:changed', (event) => {
      if (event.serverId === server.id) void load()
    })
    return () => {
      alive = false
      clearInterval(timer)
      off()
    }
  }, [server.id, running])

  const onlineIn = (dimension: WorldDimension): number =>
    Object.values(dimensions).filter((id) => dimensionOf(id) === dimension).length

  return (
    <Card title="Worlds" className={`flex flex-col ${className}`}>
      {failed ? (
        <p className="text-sm text-faint">Couldn&apos;t read the world folders.</p>
      ) : worlds === null ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : worlds.length === 0 ? (
        <p className="text-sm text-faint">Start the server once to generate the world.</p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {worlds.map((world) => (
            <li
              key={world.dimension}
              title={world.folder}
              className="flex items-center gap-3 rounded-btn border border-border-soft bg-sidebar px-3 py-1"
            >
              <span
                aria-hidden="true"
                className="h-8 w-8 shrink-0 rounded-sm"
                style={{ background: SWATCH[world.dimension] }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium leading-tight text-text">
                  {DIMENSION_LABEL[world.dimension]}
                </span>
                <span className="block truncate text-xs leading-tight text-muted">
                  {running && `${onlineIn(world.dimension)} online · `}
                  {world.chunks.toLocaleString()} chunks
                </span>
              </span>
              <span className="shrink-0 font-mono text-[13px] text-text-2">
                {formatBytes(world.bytes)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {footer && <div className="mt-2.5 shrink-0">{footer}</div>}
    </Card>
  )
}

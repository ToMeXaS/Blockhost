import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlayerLists, ServerView } from '../../../shared/types'
import { api, errorMessage } from '../lib/api'
import { DIMENSION_LABEL, dimensionOf, formatSession } from '../lib/format'
import { SearchIcon } from './icons'
import { Avatar, Button } from './ui'

const CONFIRM_MS = 4000

/** Who is online right now, with how long they've played and a quick kick. */
export function OnlinePlayersCard({
  server,
  className = ''
}: {
  server: ServerView
  className?: string
}) {
  const [lists, setLists] = useState<PlayerLists | null>(null)
  const [query, setQuery] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const running = server.status === 'running'

  const requestIdRef = useRef(0)
  const refresh = useCallback(() => {
    const requestId = ++requestIdRef.current
    api
      .getPlayers(server.id)
      .then((result) => {
        if (requestId === requestIdRef.current) setLists(result)
      })
      .catch(() => {})
  }, [server.id])

  useEffect(() => refresh(), [refresh, server.status])
  useEffect(
    () =>
      api.on('players:changed', (event) => {
        if (event.serverId === server.id) refresh()
      }),
    [server.id, refresh]
  )

  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [running])

  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(null), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [confirming])

  async function kick(name: string) {
    if (confirming !== name) {
      setConfirming(name)
      return
    }
    setConfirming(null)
    setBusy(true)
    setError(null)
    try {
      setLists(await api.playerAction(server.id, { type: 'kick', name }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const online = running ? (lists?.online ?? []) : []
  const needle = query.trim().toLowerCase()
  const shown = needle ? online.filter((n) => n.toLowerCase().includes(needle)) : online
  const isOp = (name: string) =>
    lists?.ops.some((o) => o.name.toLowerCase() === name.toLowerCase()) ?? false

  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-card border border-border bg-panel ${className}`}
    >
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
        <h2 className="shrink-0 whitespace-nowrap text-[15px] font-semibold text-text">
          Online players <span className="font-normal text-muted">· {online.length}</span>
        </h2>
        <label className="flex h-9 w-full min-w-0 max-w-[200px] items-center gap-2 rounded-btn border border-border-strong bg-sidebar px-3 transition-colors focus-within:border-accent">
          <SearchIcon className="h-4 w-4 shrink-0 text-faint" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
            placeholder="Search players"
            aria-label="Search players"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {error && (
        <p className="mx-5 mb-2 rounded-btn border border-bad-border bg-bad-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-5 pb-3">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-panel">
            <tr className="text-left text-[13px] text-muted">
              <th className="border-b border-border-soft py-2 pr-3 font-normal">Player</th>
              <th className="border-b border-border-soft px-3 py-2 font-normal">World</th>
              <th className="border-b border-border-soft px-3 py-2 font-normal">Session</th>
              <th className="border-b border-border-soft py-2 pl-3 text-right font-normal">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((name) => {
              const since = lists?.onlineSince[name]
              const op = isOp(name)
              const dimensionId = lists?.dimensions[name]
              const dimension = dimensionOf(dimensionId)
              return (
                <tr key={name} className="[&:last-child>td]:border-b-0">
                  <td className="border-b border-border-soft py-2 pr-3">
                    <span className="flex items-center gap-3">
                      <Avatar name={name} size={30} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-text">{name}</span>
                        <span className={`block text-xs ${op ? 'text-warn' : 'text-muted'}`}>
                          {op ? 'Operator' : 'Member'}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="border-b border-border-soft px-3 py-2 text-text-2">
                    {dimension ? DIMENSION_LABEL[dimension] : (dimensionId ?? '—')}
                  </td>
                  <td className="border-b border-border-soft px-3 py-2 font-mono text-[13px] text-text-2">
                    {since === undefined ? '—' : formatSession(now - since)}
                  </td>
                  <td className="border-b border-border-soft py-2 pl-3 text-right">
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => void kick(name)}
                    >
                      {confirming === name ? 'Confirm' : 'Kick'}
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="py-6 text-center text-sm text-faint">
            {!running
              ? 'Start the server to see who’s online'
              : online.length === 0
                ? 'No one online'
                : 'No players match your search'}
          </p>
        )}
      </div>
    </section>
  )
}

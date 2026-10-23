import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ServerView } from '../../../shared/types'
import { api, errorMessage } from '../lib/api'
import { matchesFilter, parseLogLevel, type LogFilter, type ParsedLine } from '../lib/logLevel'
import { LogLine } from './LogLine'
import { Button } from './ui'

interface Line extends ParsedLine {
  id: number
  text: string
}

const MAX_LINES = 5000
const MAX_HISTORY = 50

/** Sent commands per server, kept for the app session. */
const histories = new Map<string, string[]>()

function historyFor(serverId: string): string[] {
  let history = histories.get(serverId)
  if (!history) {
    history = []
    histories.set(serverId, history)
  }
  return history
}

const FILTERS: { value: LogFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'warnings', label: 'Warnings' },
  { value: 'chat', label: 'Chat' }
]

/** The live console card: filter tabs, scrolling output and a command line. */
export function ConsolePanel({
  server,
  className = ''
}: {
  server: ServerView
  className?: string
}) {
  const [lines, setLines] = useState<Line[]>([])
  const [filter, setFilter] = useState<LogFilter>('all')
  const [command, setCommand] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const nextId = useRef(0)
  const historyIndex = useRef(-1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    historyIndex.current = -1
    setCommand('')
  }, [server.id])

  useEffect(() => {
    // Events that arrive before the backfill are already contained in it, so they are dropped.
    let ready = false
    const toLines = (texts: string[]): Line[] =>
      texts.map((text) => ({ id: nextId.current++, text, ...parseLogLevel(text) }))
    const off = api.on('server:log', (event) => {
      if (!ready || event.serverId !== server.id) return
      setLines((prev) => {
        const next = prev.concat(toLines(event.lines))
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
      })
    })
    api
      .getLog(server.id)
      .then((log) => setLines(toLines(log)))
      .catch(() => {})
      .finally(() => {
        ready = true
      })
    return off
  }, [server.id])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [lines, filter])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    stickToBottom.current = bottom
    setAtBottom(bottom)
  }

  function jumpToLatest() {
    const el = scrollRef.current
    if (!el) return
    // onScroll re-enables sticking to the bottom once the animation arrives there.
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  const canSend = server.status === 'running' || server.status === 'starting'

  async function send() {
    const cmd = command.trim().replace(/^\//, '')
    if (!cmd) return
    setError(null)
    try {
      await api.sendCommand(server.id, cmd)
      const history = historyFor(server.id)
      history.push(cmd)
      if (history.length > MAX_HISTORY) history.shift()
      historyIndex.current = -1
      setCommand('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      void send()
      return
    }
    const h = historyFor(server.id)
    if (h.length === 0) return
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      historyIndex.current =
        historyIndex.current < 0 ? h.length - 1 : Math.max(0, historyIndex.current - 1)
      setCommand(h[historyIndex.current]!)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex.current < 0) return
      historyIndex.current += 1
      if (historyIndex.current >= h.length) {
        historyIndex.current = -1
        setCommand('')
      } else {
        setCommand(h[historyIndex.current]!)
      }
    }
  }

  const shown = filter === 'all' ? lines : lines.filter((l) => matchesFilter(l.level, filter))

  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-card border border-border bg-panel ${className}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-3">
        <h2 className="text-[15px] font-semibold text-text">Console</h2>
        <div role="group" aria-label="Filter console" className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={f.value === filter}
              onClick={() => setFilter(f.value)}
              className={`rounded-btn border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                f.value === filter
                  ? 'border-border-strong bg-panel-2 text-text'
                  : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-console">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="absolute inset-0 overflow-auto px-5 py-3 font-mono text-[13px] leading-6"
        >
          {lines.length === 0 ? (
            <div className="text-faint">No output yet. Start the server to see its console.</div>
          ) : shown.length === 0 ? (
            <div className="text-faint">No lines match this filter.</div>
          ) : (
            shown.map((line) => (
              <LogLine key={line.id} text={line.text} level={line.level} tagEnd={line.tagEnd} />
            ))
          )}
        </div>
        {!atBottom && (
          <Button size="sm" className="absolute bottom-3 right-5 shadow-lg" onClick={jumpToLatest}>
            Jump to latest ↓
          </Button>
        )}
      </div>

      {error && (
        <p className="border-t border-bad-border bg-bad-bg px-5 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-border-soft py-2.5 pl-5 pr-3">
        <span className="font-mono text-sm text-accent">&gt;</span>
        <input
          className="h-9 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-text outline-none placeholder:text-faint disabled:opacity-50"
          placeholder={
            canSend ? 'Type a command, e.g. say Hello' : 'Start the server to send commands'
          }
          aria-label="Console command"
          disabled={!canSend}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button disabled={!canSend || !command.trim()} onClick={() => void send()}>
          Send
        </Button>
      </div>
    </section>
  )
}

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ServerView } from '../../../../shared/types'
import { LogLine } from '../../components/LogLine'
import { Button, ErrorText, Segmented } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { matchesFilter, parseLogLevel, type LogFilter, type ParsedLine } from '../../lib/logLevel'

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

export function ConsoleSection({ server }: { server: ServerView }) {
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
    el.scrollTop = el.scrollHeight
    stickToBottom.current = true
    setAtBottom(true)
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
    <div className="flex h-full min-h-[320px] flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Segmented label="Filter console" options={FILTERS} value={filter} onChange={setFilter} />
        <span className="font-mono text-xs text-faint">{lines.length} lines</span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="absolute inset-0 overflow-auto rounded-card border border-border bg-console p-4 font-mono text-[13px] leading-6"
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

      {error && <ErrorText>{error}</ErrorText>}

      <div className="flex items-center gap-2 rounded-btn border border-border-strong bg-sidebar pl-3 transition-colors focus-within:border-accent">
        <span className="font-mono text-sm text-accent">&gt;</span>
        <input
          className="h-10 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-text outline-none placeholder:text-faint disabled:opacity-50"
          placeholder={
            canSend ? 'Type a command, e.g. op YourName' : 'Start the server to send commands'
          }
          aria-label="Console command"
          disabled={!canSend}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          variant="primary"
          size="sm"
          className="mr-1"
          disabled={!canSend || !command.trim()}
          onClick={() => void send()}
        >
          Send
        </Button>
      </div>
    </div>
  )
}

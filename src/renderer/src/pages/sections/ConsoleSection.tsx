import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ServerView } from '../../../../shared/types'
import { Button, ErrorText, inputClass } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'

interface Line {
  id: number
  text: string
}

const MAX_LINES = 5000

function lineClass(text: string): string {
  if (text.startsWith('[Blockhost]')) return 'text-sky-400'
  if (text.startsWith('> ')) return 'text-emerald-400'
  if (/\b(ERROR|SEVERE|FATAL)\b|Exception/.test(text)) return 'text-red-400'
  if (/\bWARN(ING)?\b/.test(text)) return 'text-amber-300'
  return 'text-zinc-300'
}

const LogLine = memo(function LogLine({ text }: { text: string }) {
  return <div className={`whitespace-pre-wrap break-all ${lineClass(text)}`}>{text}</div>
})

export function ConsoleSection({ server }: { server: ServerView }) {
  const [lines, setLines] = useState<Line[]>([])
  const [command, setCommand] = useState('')
  const [error, setError] = useState<string | null>(null)
  const nextId = useRef(0)
  const history = useRef<string[]>([])
  const historyIndex = useRef(-1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    // Events that arrive before the backfill are already contained in it, so they are dropped.
    let ready = false
    const toLines = (texts: string[]): Line[] =>
      texts.map((text) => ({ id: nextId.current++, text }))
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
  }, [lines])

  function onScroll() {
    const el = scrollRef.current
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const canSend = server.status === 'running' || server.status === 'starting'

  async function send() {
    const cmd = command.trim().replace(/^\//, '')
    if (!cmd) return
    setError(null)
    try {
      await api.sendCommand(server.id, cmd)
      history.current.push(cmd)
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
    const h = history.current
    if (h.length === 0) return
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      historyIndex.current =
        historyIndex.current < 0 ? h.length - 1 : Math.max(0, historyIndex.current - 1)
      setCommand(h[historyIndex.current])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex.current < 0) return
      historyIndex.current += 1
      if (historyIndex.current >= h.length) {
        historyIndex.current = -1
        setCommand('')
      } else {
        setCommand(h[historyIndex.current])
      }
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto rounded-md border border-zinc-800 bg-black p-3 font-mono text-xs leading-5"
      >
        {lines.length === 0 ? (
          <div className="text-zinc-600">No output yet. Start the server to see its console.</div>
        ) : (
          lines.map((line) => <LogLine key={line.id} text={line.text} />)
        )}
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex gap-2">
        <input
          className={`${inputClass} font-mono`}
          placeholder={
            canSend ? 'Type a command, e.g. op YourName' : 'Start the server to send commands'
          }
          disabled={!canSend}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          variant="primary"
          disabled={!canSend || !command.trim()}
          onClick={() => void send()}
        >
          Send
        </Button>
      </div>
    </div>
  )
}

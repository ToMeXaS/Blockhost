import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { InstallState, InstallStep } from '../../../shared/types'
import { api } from '../lib/api'

export type PanelState = 'running' | 'done' | 'error'

const STEPS: { step: InstallStep; label: string }[] = [
  { step: 'java', label: 'Java runtime' },
  { step: 'server', label: 'Server files' },
  { step: 'installer', label: 'Mod loader setup' },
  { step: 'config', label: 'Configuration' }
]
const ORDER: InstallStep[] = ['java', 'server', 'installer', 'config', 'done']

interface Props {
  serverId: string
  initialState: InstallState
  actions?: (state: PanelState) => ReactNode
}

export function InstallPanel({ serverId, initialState, actions }: Props) {
  const [lines, setLines] = useState<string[]>([])
  const [step, setStep] = useState<InstallStep | null>(null)
  const [percent, setPercent] = useState<number | undefined>(undefined)
  const [state, setState] = useState<PanelState>(
    initialState === 'failed' ? 'error' : initialState === 'ready' ? 'done' : 'running'
  )
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Events that arrive before the backfill are already contained in it, so they are dropped.
    let ready = false
    const off = api.on('install:progress', (event) => {
      if (!ready || event.serverId !== serverId) return
      if (event.message) setLines((prev) => [...prev.slice(-999), event.message])
      if (event.step === 'error') {
        setState('error')
        return
      }
      if (event.step === 'done') {
        setState('done')
        setStep('done')
        return
      }
      setState('running')
      setStep(event.step)
      setPercent(event.percent)
    })
    api
      .getInstallLog(serverId)
      .then((log) => setLines(log))
      .catch(() => {})
      .finally(() => {
        ready = true
      })
    return off
  }, [serverId])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const current = step ? ORDER.indexOf(step) : -1

  return (
    <div className="space-y-4">
      <ol className="space-y-2">
        {STEPS.map((s, i) => {
          const done = state === 'done' || current > i
          const active = state === 'running' && current === i
          return (
            <li key={s.step} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                  done
                    ? 'bg-emerald-600 text-white'
                    : active
                      ? 'bg-amber-500 text-black'
                      : 'bg-zinc-800 text-zinc-500'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>
              <span className={active ? 'text-zinc-100' : 'text-zinc-400'}>{s.label}</span>
              {active && percent !== undefined && (
                <span className="text-xs text-zinc-500">{percent}%</span>
              )}
            </li>
          )
        })}
      </ol>

      {state === 'done' && (
        <p className="text-sm text-emerald-400">Server installed and ready to start.</p>
      )}
      {state === 'error' && (
        <p className="text-sm text-red-400">
          Installation failed. Check the log below, then retry.
        </p>
      )}

      <div
        ref={logRef}
        className="h-64 overflow-auto rounded-md border border-zinc-800 bg-black p-3 font-mono text-xs leading-5 text-zinc-300"
      >
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {line}
          </div>
        ))}
      </div>

      {actions && <div className="flex gap-2">{actions(state)}</div>}
    </div>
  )
}

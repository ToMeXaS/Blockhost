import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { addToast, removeToast, TOAST_DURATION, type Toast, type ToastTone } from '../lib/toasts'
import { AlertIcon, CheckCircleIcon, CloseIcon, InfoIcon, WarningIcon } from './icons'

type Notify = (message: string) => void

export interface ToastApi {
  success: Notify
  error: Notify
  warn: Notify
  info: Notify
}

const ToastContext = createContext<ToastApi | null>(null)

/** Short-lived messages about something the user just did. Ongoing state stays inline. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside <ToastProvider>')
  return api
}

const TONES: Record<ToastTone, { label: string; icon: ReactNode }> = {
  success: { label: 'Success', icon: <CheckCircleIcon /> },
  error: { label: 'Error', icon: <AlertIcon /> },
  warn: { label: 'Warning', icon: <WarningIcon /> },
  info: { label: 'Info', icon: <InfoIcon /> }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((list) => removeToast(list, id)), [])

  const api = useMemo<ToastApi>(() => {
    const push = (tone: ToastTone) => (message: string) =>
      setToasts((list) => addToast(list, { id: nextId.current++, tone, message }))
    return {
      success: push('success'),
      error: push('error'),
      warn: push('warn'),
      info: push('info')
    }
  }, [])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed right-5 bottom-5 z-[60] flex w-[380px] max-w-[calc(100vw-2.5rem)] flex-col gap-2.5">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const remaining = useRef(TOAST_DURATION[toast.tone])

  // Counts down only while the pointer is away, so hovering keeps a toast up to read it.
  useEffect(() => {
    if (paused || leaving) return
    const startedAt = Date.now()
    const timer = setTimeout(() => setLeaving(true), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current -= Date.now() - startedAt
    }
  }, [paused, leaving])

  const tone = TONES[toast.tone]
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      data-tone={toast.tone}
      data-leaving={leaving || undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      // Removed once the leave animation finishes; the progress bar's own animation bubbles here too.
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget) onDismiss(toast.id)
      }}
      className="toast group pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-card border border-border-strong py-3 pr-3 pl-3"
    >
      <span className="toast-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-btn [&>svg]:h-[18px] [&>svg]:w-[18px]">
        {tone.icon}
      </span>
      <div className="min-w-0 flex-1 pt-px">
        <div className="toast-label text-[11px] font-semibold tracking-[0.08em] uppercase">
          {tone.label}
        </div>
        <p className="mt-0.5 text-[13px] leading-snug break-words text-text-2">{toast.message}</p>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setLeaving(true)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-faint opacity-0 transition group-hover:opacity-100 hover:bg-panel-2 hover:text-text focus-visible:opacity-100"
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
      <div className="absolute inset-x-0 bottom-0 h-[2px] bg-border-soft">
        <div
          className="toast-progress h-full w-full"
          style={{ animationDuration: `${TOAST_DURATION[toast.tone]}ms` }}
        />
      </div>
    </div>
  )
}

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  type TdHTMLAttributes,
  type ThHTMLAttributes
} from 'react'
import { createPortal } from 'react-dom'
import { SERVER_TYPE_LABELS, type ServerStatus, type ServerView } from '../../../shared/types'
import { avatarColor, STATUS_DOT, STATUS_LABEL } from '../lib/format'

/** Padding and max width shared by every page. */
export const pageClass = 'mx-auto w-full max-w-[1200px] px-8 py-7'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent font-semibold text-accent-ink hover:brightness-110',
  secondary: 'border border-border-strong bg-panel-2 text-text hover:bg-nav-active',
  danger: 'border border-stop-border bg-stop-bg text-stop-text hover:brightness-125',
  ghost: 'text-text-2 hover:bg-panel-2 hover:text-text'
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-3.5 text-sm'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-btn font-medium transition disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

export const inputClass =
  'w-full rounded-btn border border-border-strong bg-sidebar px-3 py-2 text-sm text-text outline-none transition-colors placeholder:text-faint focus:border-accent disabled:opacity-50'

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[13px] font-medium text-text-2">{label}</div>
      {children}
      {hint && <div className="text-xs text-faint">{hint}</div>}
    </div>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-btn border border-bad-border bg-bad-bg px-3 py-2 text-sm text-danger">
      {children}
    </p>
  )
}

const NOTICE_TONES = {
  ok: 'border-ok-border bg-ok-bg text-ok-text',
  warn: 'border-warn-border bg-warn-bg text-warn',
  info: 'border-border-strong bg-panel-2 text-text-2'
} as const

export function Notice({
  tone,
  children
}: {
  tone: keyof typeof NOTICE_TONES
  children: ReactNode
}) {
  return (
    <div className={`rounded-btn border px-3 py-2 text-sm ${NOTICE_TONES[tone]}`}>{children}</div>
  )
}

export function Card({
  title,
  description,
  actions,
  className = '',
  children
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <section className={`rounded-card border border-border bg-panel p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-text">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

const PILL_TONES: Record<ServerStatus, string> = {
  running: 'border-ok-border bg-ok-bg text-ok-text',
  starting: 'border-warn-border bg-warn-bg text-warn',
  stopping: 'border-warn-border bg-warn-bg text-warn',
  stopped: 'border-bad-border bg-bad-bg text-danger',
  crashed: 'border-bad-border bg-bad-bg text-danger'
}

export function StatusPill({ status }: { status: ServerStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${PILL_TONES[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  )
}

export const StatusBadge = StatusPill

const BADGE_TONES = {
  neutral: 'border-border-strong bg-panel-2 text-text-2',
  accent: 'border-ok-border bg-ok-bg text-ok-text',
  info: 'border-info-border bg-info-bg text-info',
  warn: 'border-warn-border bg-warn-bg text-warn',
  danger: 'border-bad-border bg-bad-bg text-danger'
} as const

export function Badge({
  tone = 'neutral',
  mono = false,
  children
}: {
  tone?: keyof typeof BADGE_TONES
  mono?: boolean
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs ${mono ? 'font-mono' : ''} ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  )
}

const TILE_BARS = {
  accent: 'bg-accent',
  info: 'bg-info',
  warn: 'bg-warn'
} as const

export function StatTile({
  label,
  value,
  unit,
  chip,
  bar,
  barTone
}: {
  label: string
  value: ReactNode
  unit?: ReactNode
  chip?: ReactNode
  /** 0–100; values outside are clamped. */
  bar: number
  barTone: keyof typeof TILE_BARS
}) {
  const width = Math.max(0, Math.min(100, bar))
  return (
    <div className="rounded-card border border-border bg-panel px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <span title={label} className="truncate whitespace-nowrap text-[13px] text-muted">
          {label}
        </span>
        {chip}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[30px] font-semibold leading-none tracking-tight text-text">
          {value}
        </span>
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-panel-2">
        <div
          className={`h-full rounded-full transition-[width] ${TILE_BARS[barTone]}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

export function TypeBadge({ server }: { server: Pick<ServerView, 'type' | 'mcVersion'> }) {
  return (
    <Badge mono>
      {SERVER_TYPE_LABELS[server.type]} {server.mcVersion}
    </Badge>
  )
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  id
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label: string
  id?: string
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'border-accent bg-accent' : 'border-border-strong bg-panel-2'
      }`}
    >
      <span
        className={`h-3.5 w-3.5 rounded-full transition-transform ${
          checked ? 'translate-x-[18px] bg-accent-ink' : 'translate-x-[2px] bg-muted'
        }`}
      />
    </button>
  )
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-btn border border-border bg-sidebar p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-sm px-3 py-1 text-[13px] font-medium transition-colors ${
            o.value === value ? 'bg-nav-active text-text' : 'text-muted hover:text-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-btn border border-border-soft">
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}

export function Th({ className = '', ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`border-b border-border-soft bg-sidebar px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted ${className}`}
      {...props}
    />
  )
}

export function Td({ className = '', ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`border-b border-border-soft px-3 py-2.5 text-text-2 ${className}`} {...props} />
  )
}

/** Row class: hover tint and no border under the last row. */
export const trClass = 'transition-colors hover:bg-panel-2/60 [&:last-child>td]:border-b-0'

export type MenuEntry =
  | 'divider'
  | {
      label: string
      onSelect: () => void
      icon?: ReactNode
      hint?: ReactNode
      disabled?: boolean
      danger?: boolean
      selected?: boolean
    }

export function Menu({
  label,
  button,
  buttonClassName = '',
  items,
  align = 'left'
}: {
  label: string
  button: ReactNode
  buttonClassName?: string
  items: MenuEntry[]
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // The menu is pinned to where the button was, so it would drift if anything scrolled.
    const close = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  // Rendered into <body> with fixed coordinates so scrolling or overflow-clipped parents
  // (tables, the sidebar) can't cut it off. Opens upwards when there's no room below.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) {
      setPos(null)
      return
    }
    const anchor = buttonRef.current.getBoundingClientRect()
    const { offsetWidth: width, offsetHeight: height } = menuRef.current
    const gap = 4
    const margin = 8
    const fitsBelow = anchor.bottom + gap + height <= window.innerHeight - margin
    const top = fitsBelow ? anchor.bottom + gap : Math.max(margin, anchor.top - gap - height)
    const left = align === 'right' ? anchor.right - width : anchor.left
    setPos({ top, left: Math.min(Math.max(margin, left), window.innerWidth - margin - width) })
  }, [open, align])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={buttonClassName}
      >
        {button}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={pos ?? { top: 0, left: 0, visibility: 'hidden' }}
            className="fixed z-50 min-w-[220px] rounded-btn border border-border-strong bg-panel p-1 shadow-xl shadow-black/40"
          >
            {items.map((item, i) =>
              item === 'divider' ? (
                <div key={`divider-${i}`} role="separator" className="my-1 h-px bg-border-soft" />
              ) : (
                <button
                  key={`${i}-${item.label}`}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false)
                    item.onSelect()
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm transition-colors hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
                    item.danger ? 'text-stop-text' : item.selected ? 'text-text' : 'text-text-2'
                  }`}
                >
                  {item.icon && (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">
                      {item.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    {item.hint && (
                      <span className="block truncate text-xs text-faint">{item.hint}</span>
                    )}
                  </span>
                </button>
              )
            )}
          </div>,
          document.body
        )}
    </>
  )
}

/** A letter avatar for a player (no skin images, so no CSP change). */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-sm font-mono text-xs font-semibold text-accent-ink"
      style={{ width: size, height: size, backgroundColor: avatarColor(name) }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function TextLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[13px] font-medium text-link hover:underline"
    >
      {children}
    </button>
  )
}

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { SERVER_TYPE_LABELS, type ServerStatus, type ServerView } from '../../../shared/types'
import { STATUS_DOT, STATUS_LABEL } from '../lib/format'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-emerald-600 text-white hover:bg-emerald-500',
  secondary: 'border border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700',
  danger: 'bg-red-700 text-white hover:bg-red-600',
  ghost: 'text-zinc-300 hover:bg-zinc-800'
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

export const inputClass =
  'w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-500 disabled:opacity-50'

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
    <div className="space-y-1">
      <div className="text-sm font-medium text-zinc-300">{label}</div>
      {children}
      {hint && <div className="text-xs text-zinc-500">{hint}</div>}
    </div>
  )
}

export function StatusBadge({ status }: { status: ServerStatus }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-zinc-300">
      <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function TypeBadge({ server }: { server: Pick<ServerView, 'type' | 'mcVersion'> }) {
  return (
    <span className="whitespace-nowrap rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
      {SERVER_TYPE_LABELS[server.type]} {server.mcVersion}
    </span>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
      {children}
    </p>
  )
}

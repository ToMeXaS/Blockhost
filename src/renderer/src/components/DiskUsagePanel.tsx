import { useEffect, useState } from 'react'
import type { ServerView } from '../../../shared/types'
import { useBackups } from '../hooks/useBackups'
import { useDiskUsage } from '../hooks/useDiskUsage'
import { backupHint, fillLevel, formatBytes } from '../lib/format'

const BAR_COLOR = { ok: 'bg-accent', warn: 'bg-warn', over: 'bg-danger' } as const
/** Keeps the "Next backup in…" countdown current. */
const HINT_REFRESH_MS = 30_000

function Bar({ label, ratio }: { label: string; ratio: number }) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(1, ratio) * 100)}
      className="h-1.5 overflow-hidden rounded-full bg-panel-2"
    >
      <span
        className={`block h-full rounded-full ${BAR_COLOR[fillLevel(ratio)]}`}
        style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
      />
    </div>
  )
}

function BackupLine({ server }: { server: ServerView }) {
  const { list } = useBackups(server.id)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), HINT_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  if (!list) return null
  const hint = backupHint(
    list,
    server.backup?.intervalHours ?? null,
    server.status === 'running',
    now
  )
  return <div className={hint.warn ? 'text-warn' : 'text-muted'}>{hint.text}</div>
}

export function DiskUsagePanel({ server }: { server: ServerView }) {
  const usage = useDiskUsage(server.id)
  if (!usage || usage.totalBytes <= 0) return null
  const limitBytes = server.diskLimitMb === undefined ? null : server.diskLimitMb * 1024 ** 2
  const limitRatio = limitBytes === null ? 0 : usage.serverBytes / limitBytes
  return (
    <div className="space-y-2.5 rounded-card border border-border bg-panel px-3.5 py-3 text-[12px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted">Disk</span>
        <span className="font-mono text-text">
          {formatBytes(usage.serverBytes)}
          {limitBytes !== null && <span className="text-faint"> / {formatBytes(limitBytes)}</span>}
        </span>
      </div>
      {limitBytes !== null ? (
        <Bar label="Disk limit used" ratio={limitRatio} />
      ) : (
        <Bar label={`Drive ${usage.drive} used`} ratio={1 - usage.freeBytes / usage.totalBytes} />
      )}
      {limitRatio >= 1 && (
        <div className="text-[11px] text-danger">Over limit. The server can't start.</div>
      )}
      <div className="flex flex-wrap gap-x-2 font-mono text-[11px] text-faint">
        <span className="whitespace-nowrap">
          {usage.drive} {formatBytes(usage.freeBytes)} free
        </span>
        {usage.backupsBytes !== undefined && usage.backupsBytes > 0 && (
          <span className="whitespace-nowrap">· Backups {formatBytes(usage.backupsBytes)}</span>
        )}
      </div>
      <BackupLine server={server} />
    </div>
  )
}

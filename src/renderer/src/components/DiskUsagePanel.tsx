import { useDiskUsage } from '../hooks/useDiskUsage'
import { fillLevel, formatBytes } from '../lib/format'

const BAR_COLOR = { ok: 'bg-accent', warn: 'bg-warn', over: 'bg-danger' } as const

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

export function DiskUsagePanel({
  serverId,
  diskLimitMb
}: {
  serverId: string
  diskLimitMb?: number
}) {
  const usage = useDiskUsage(serverId)
  if (!usage || usage.totalBytes <= 0) return null
  const limitBytes = diskLimitMb === undefined ? null : diskLimitMb * 1024 ** 2
  const limitRatio = limitBytes === null ? 0 : usage.serverBytes / limitBytes
  return (
    <div className="space-y-1.5 rounded-btn border border-border bg-panel px-3 py-2.5 text-[12px]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Disk</div>
      <div className="flex items-baseline justify-between">
        <span className="text-muted">This server</span>
        <span className="font-mono text-text">
          {formatBytes(usage.serverBytes)}
          {limitBytes !== null && <span className="text-faint"> / {formatBytes(limitBytes)}</span>}
        </span>
      </div>
      {limitBytes !== null && (
        <>
          <Bar label="Disk limit used" ratio={limitRatio} />
          {limitRatio >= 1 && (
            <div className="text-[11px] text-danger">Over limit. The server can't start.</div>
          )}
        </>
      )}
      <Bar label={`Drive ${usage.drive} used`} ratio={1 - usage.freeBytes / usage.totalBytes} />
      <div className="flex justify-between font-mono text-[11px] text-faint">
        <span>{usage.drive}</span>
        <span>
          {formatBytes(usage.freeBytes)} free / {formatBytes(usage.totalBytes)}
        </span>
      </div>
    </div>
  )
}

import type { ServerView } from '../../../shared/types'
import type { ServerStats } from '../hooks/useServerStats'
import { formatRam } from '../lib/format'
import { formatGb, MAX_TPS, memPercent, TPS_HEALTH_LABEL, tpsHealth } from '../lib/stats'
import { Badge, StatTile } from './ui'

const HEALTH_TONE = { healthy: 'accent', lagging: 'warn', struggling: 'danger' } as const

interface Props {
  server: ServerView
  online: number
  maxPlayers: number | null
  stats: ServerStats
}

function Note({ children }: { children: string }) {
  return <span className="text-base font-normal text-muted">{children}</span>
}

export function PerformanceTiles({ server, online, maxPlayers, stats }: Props) {
  const running = server.status === 'running'
  const latest = stats.points.at(-1)
  const offline = <Badge>Offline</Badge>
  const ram = `/ ${formatRam(server.ramMb)}`

  const players = (
    <StatTile
      label="Players"
      value={running ? online : '—'}
      unit={maxPlayers === null ? undefined : `/ ${maxPlayers}`}
      chip={
        running ? (
          <Badge tone={online > 0 ? 'accent' : 'neutral'}>{online > 0 ? 'Online' : 'Empty'}</Badge>
        ) : (
          offline
        )
      }
      bar={running && maxPlayers ? (online / maxPlayers) * 100 : 0}
      barTone="accent"
    />
  )

  const tps = latest?.tps ?? null
  const tpsTile = !running ? (
    <StatTile
      label="Ticks per second"
      value="—"
      unit="TPS"
      chip={offline}
      bar={0}
      barTone="accent"
    />
  ) : stats.loaded && !stats.tpsSupported ? (
    <StatTile
      label="Ticks per second"
      value={<Note>Not available</Note>}
      bar={0}
      barTone="accent"
    />
  ) : (
    <StatTile
      label="Ticks per second"
      value={tps === null ? '—' : tps.toFixed(1)}
      unit="TPS"
      chip={
        tps === null ? undefined : (
          <Badge tone={HEALTH_TONE[tpsHealth(tps)]}>{TPS_HEALTH_LABEL[tpsHealth(tps)]}</Badge>
        )
      }
      bar={tps === null ? 0 : (tps / MAX_TPS) * 100}
      barTone="accent"
    />
  )

  const mem = latest?.memBytes ?? null
  const memPct = mem === null ? 0 : memPercent(mem, server.ramMb)
  const memTile = !running ? (
    <StatTile label="Memory" value="—" unit={ram} chip={offline} bar={0} barTone="info" />
  ) : !stats.samplerAvailable ? (
    <StatTile label="Memory" value={<Note>Unavailable</Note>} bar={0} barTone="info" />
  ) : (
    <StatTile
      label="Memory"
      value={mem === null ? '—' : formatGb(mem)}
      unit={ram}
      chip={
        mem === null ? undefined : (
          <Badge tone="info" mono>
            {Math.round(memPct)}%
          </Badge>
        )
      }
      bar={memPct}
      barTone="info"
    />
  )

  const cpu = latest?.cpu ?? null
  const cpuTile = !running ? (
    <StatTile label="CPU" value="—" unit="%" chip={<Badge>Idle</Badge>} bar={0} barTone="warn" />
  ) : !stats.samplerAvailable ? (
    <StatTile label="CPU" value={<Note>Unavailable</Note>} bar={0} barTone="warn" />
  ) : (
    <StatTile
      label="CPU"
      value={cpu === null ? '—' : Math.round(cpu)}
      unit="%"
      chip={
        stats.cores > 0 ? (
          <Badge tone="warn" mono>
            {stats.cores} cores
          </Badge>
        ) : undefined
      }
      bar={cpu ?? 0}
      barTone="warn"
    />
  )

  return (
    <div className="grid shrink-0 grid-cols-2 gap-3 min-[1000px]:grid-cols-4">
      {players}
      {tpsTile}
      {memTile}
      {cpuTile}
    </div>
  )
}

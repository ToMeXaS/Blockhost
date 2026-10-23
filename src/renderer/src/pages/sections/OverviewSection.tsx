import { useEffect, useState } from 'react'
import type { ServerView } from '../../../../shared/types'
import { ConsolePanel } from '../../components/ConsolePanel'
import { OnlinePlayersCard } from '../../components/OnlinePlayersCard'
import { PerformanceChart, PerformanceLegend } from '../../components/PerformanceChart'
import { PerformanceTiles } from '../../components/PerformanceTiles'
import { WorldsCard } from '../../components/WorldsCard'
import { Card } from '../../components/ui'
import { useBackups } from '../../hooks/useBackups'
import { useServerStats } from '../../hooks/useServerStats'
import { api, errorMessage } from '../../lib/api'

function BackupNowButton({ serverId }: { serverId: string }) {
  const { progress } = useBackups(serverId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const working = busy || progress !== null

  const backUp = () => {
    setBusy(true)
    setError(null)
    api
      .backupsCreate(serverId)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={working}
        onClick={backUp}
        className="flex h-9 w-full items-center justify-center rounded-btn border border-dashed border-border-strong text-sm font-medium text-text-2 transition-colors hover:border-accent hover:text-text disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border-strong"
      >
        {progress?.op === 'restore'
          ? 'Restoring…'
          : working
            ? `Backing up… ${Math.round(progress?.percent ?? 0)}%`
            : 'Create backup now'}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}

interface Props {
  server: ServerView
  online: string[]
}

export function OverviewSection({ server, online }: Props) {
  const stats = useServerStats(server.id, server.status)
  const [maxPlayers, setMaxPlayers] = useState<number | null>(null)
  const running = server.status === 'running'

  useEffect(() => {
    let alive = true
    api
      .readProperties(server.id)
      .then((entries) => {
        const raw = entries.find((e) => e.key === 'max-players')?.value
        const n = raw === undefined ? Number.NaN : Number(raw)
        if (alive) setMaxPlayers(Number.isInteger(n) ? n : null)
      })
      .catch(() => {
        if (alive) setMaxPlayers(null)
      })
    return () => {
      alive = false
    }
  }, [server.id])

  return (
    <div className="flex h-full flex-col gap-3">
      <PerformanceTiles
        server={server}
        online={online.length}
        maxPlayers={maxPlayers}
        stats={stats}
      />
      <div className="grid min-h-[272px] flex-1 gap-3 min-[1000px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card
          className="flex min-h-0 flex-col"
          title="Performance"
          description="Last 60 minutes"
          actions={running ? <PerformanceLegend showTps={stats.tpsSupported} /> : undefined}
        >
          {running ? (
            <div className="min-h-0 flex-1">
              <PerformanceChart
                points={stats.points}
                allocatedMb={server.ramMb}
                showTps={stats.tpsSupported}
              />
            </div>
          ) : (
            <p className="text-sm text-faint">Start the server to see performance</p>
          )}
        </Card>
        <WorldsCard
          server={server}
          className="min-h-0"
          footer={<BackupNowButton serverId={server.id} />}
        />
      </div>
      <div className="grid min-h-[180px] flex-[1.2] gap-3 min-[1000px]:grid-cols-2">
        <OnlinePlayersCard server={server} />
        <ConsolePanel server={server} />
      </div>
    </div>
  )
}

import { useMemo, useState, type MouseEvent } from 'react'
import type { StatsPoint } from '../../../shared/types'
import { formatUptime } from '../lib/format'
import { downsample, MAX_TPS, polylineSegments } from '../lib/stats'

const WIDTH = 600
const HEIGHT = 200
const TOP = 10
const BOTTOM = 190

const pctY = (v: number): number => BOTTOM - (Math.min(100, Math.max(0, v)) / 100) * (BOTTOM - TOP)
const tpsY = (v: number): number => pctY((v / MAX_TPS) * 100)

const LINE = {
  fill: 'none',
  strokeLinejoin: 'round',
  vectorEffect: 'non-scaling-stroke'
} as const

export function PerformanceLegend({ showTps }: { showTps: boolean }) {
  return (
    <div className="flex items-center gap-4 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-[3px] w-2.5 rounded-sm bg-accent" />
        CPU %
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-[3px] w-2.5 rounded-sm bg-info" />
        Memory %
      </span>
      {showTps && (
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 border-t-2 border-dashed border-warn" />
          TPS
        </span>
      )}
    </div>
  )
}

interface Props {
  points: StatsPoint[]
  allocatedMb: number
  showTps: boolean
}

export function PerformanceChart({ points, allocatedMb, showTps }: Props) {
  const data = useMemo(() => downsample(points, allocatedMb), [points, allocatedMb])
  const [hover, setHover] = useState<number | null>(null)

  if (data.length < 2) {
    return <p className="text-sm text-faint">Collecting data…</p>
  }

  const last = data.length - 1
  const index = hover === null ? null : Math.max(0, Math.min(last, hover))
  const point = index === null ? null : data[index]
  const x = index === null ? 0 : (index / last) * WIDTH

  const onMove = (e: MouseEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    setHover(Math.round(((e.clientX - rect.left) / rect.width) * last))
  }

  const pct = (v: number | null): string => (v === null ? '—' : `${Math.round(v)}%`)
  const gb = (v: number | null): string =>
    v === null ? '—' : `${((v / 100) * (allocatedMb / 1024)).toFixed(1)} GB`

  return (
    <div className="relative">
      <svg
        role="img"
        aria-label="CPU, memory and TPS over the last hour"
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="block"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {[25, 50, 75].map((v) => (
          <line
            key={v}
            x1={0}
            x2={WIDTH}
            y1={pctY(v)}
            y2={pctY(v)}
            stroke="var(--color-border)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {polylineSegments(
          data.map((d) => d.mem),
          pctY,
          WIDTH
        ).map((pts, i) => (
          <polyline
            key={`mem${i}`}
            points={pts}
            stroke="var(--color-info)"
            strokeWidth={2}
            {...LINE}
          />
        ))}
        {polylineSegments(
          data.map((d) => d.cpu),
          pctY,
          WIDTH
        ).map((pts, i) => (
          <polyline
            key={`cpu${i}`}
            points={pts}
            stroke="var(--color-accent)"
            strokeWidth={2}
            {...LINE}
          />
        ))}
        {showTps &&
          polylineSegments(
            data.map((d) => d.tps),
            tpsY,
            WIDTH
          ).map((pts, i) => (
            <polyline
              key={`tps${i}`}
              points={pts}
              stroke="var(--color-warn)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              {...LINE}
            />
          ))}
        {point && (
          <line
            x1={x}
            x2={x}
            y1={TOP}
            y2={BOTTOM}
            stroke="var(--color-border-strong)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {point && (
        <div
          className="pointer-events-none absolute top-2 rounded-btn border border-border bg-sidebar px-3 py-2 font-mono text-xs leading-5 text-text-2"
          style={{
            left: `${(x / WIDTH) * 100}%`,
            transform: x > WIDTH / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)'
          }}
        >
          <div className="text-faint">{formatUptime(Date.now() - point.at)} ago</div>
          <div>CPU {pct(point.cpu)}</div>
          <div>Memory {gb(point.mem)}</div>
          {showTps && <div>TPS {point.tps === null ? '—' : point.tps.toFixed(1)}</div>}
        </div>
      )}
    </div>
  )
}

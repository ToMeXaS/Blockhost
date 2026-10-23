import type { StatsPoint } from '../../../shared/types'

/** One hour of 5-second points, matching the main process. */
export const MAX_POINTS = 720
export const CHART_BUCKETS = 120
export const CHART_WINDOW_MS = 60 * 60_000
export const MAX_TPS = 20

export type TpsHealth = 'healthy' | 'lagging' | 'struggling'

export const TPS_HEALTH_LABEL: Record<TpsHealth, string> = {
  healthy: 'Healthy',
  lagging: 'Lagging',
  struggling: 'Struggling'
}

export function tpsHealth(tps: number): TpsHealth {
  if (tps >= 18) return 'healthy'
  return tps >= 15 ? 'lagging' : 'struggling'
}

export function formatGb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1)
}

export function memPercent(bytes: number, allocatedMb: number): number {
  return allocatedMb > 0 ? (bytes / (allocatedMb * 1024 * 1024)) * 100 : 0
}

export interface ChartPoint {
  at: number
  cpu: number | null
  /** Percent of the allocated RAM. */
  mem: number | null
  tps: number | null
}

function average(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null)
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
}

/**
 * Averages points into `buckets` equal time slots over the `windowMs` ending at `end`,
 * so the chart's x axis is real time. Slots without data stay null (a gap).
 */
export function downsample(
  points: StatsPoint[],
  allocatedMb: number,
  end: number,
  buckets = CHART_BUCKETS,
  windowMs = CHART_WINDOW_MS
): ChartPoint[] {
  const mem = (pt: StatsPoint): number | null =>
    pt.memBytes === null ? null : memPercent(pt.memBytes, allocatedMb)
  const size = windowMs / buckets
  const start = end - windowMs
  const groups: StatsPoint[][] = Array.from({ length: buckets }, () => [])
  for (const pt of points) {
    const b = Math.ceil((pt.at - start) / size) - 1
    if (b >= 0 && b < buckets) groups[b].push(pt)
  }
  return groups.map((group, b) => ({
    at: start + (b + 1) * size,
    cpu: average(group.map((pt) => pt.cpu)),
    mem: average(group.map(mem)),
    tps: average(group.map((pt) => pt.tps))
  }))
}

const coord = (n: number): number => Math.round(n * 10) / 10

/** SVG polyline `points` strings, one per unbroken run of values. */
export function polylineSegments(
  values: (number | null)[],
  toY: (v: number) => number,
  width: number
): string[] {
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const segments: string[] = []
  let current: string[] = []
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) segments.push(current.join(' '))
      current = []
      return
    }
    current.push(`${coord(i * step)},${coord(toY(v))}`)
  })
  if (current.length) segments.push(current.join(' '))
  return segments
}

export function appendPoint(points: StatsPoint[], point: StatsPoint): StatsPoint[] {
  const next = [...points, point]
  return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next
}

/** Snapshot points plus any live points that arrived after the snapshot was taken. */
export function mergePoints(snapshot: StatsPoint[], live: StatsPoint[]): StatsPoint[] {
  const last = snapshot.at(-1)?.at ?? Number.NEGATIVE_INFINITY
  return [...snapshot, ...live.filter((pt) => pt.at > last)].slice(-MAX_POINTS)
}

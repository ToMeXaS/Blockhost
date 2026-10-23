import type { StatsPoint } from '../../../shared/types'

/** One hour of 5-second points, matching the main process. */
export const MAX_POINTS = 720
export const CHART_BUCKETS = 120
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

/** Reduces points to at most `buckets` by averaging neighbours (gaps stay gaps). */
export function downsample(
  points: StatsPoint[],
  allocatedMb: number,
  buckets = CHART_BUCKETS
): ChartPoint[] {
  const mem = (pt: StatsPoint): number | null =>
    pt.memBytes === null ? null : memPercent(pt.memBytes, allocatedMb)
  if (points.length <= buckets) {
    return points.map((pt) => ({ at: pt.at, cpu: pt.cpu, mem: mem(pt), tps: pt.tps }))
  }
  const size = points.length / buckets
  const out: ChartPoint[] = []
  for (let b = 0; b < buckets; b++) {
    const slice = points.slice(Math.floor(b * size), Math.floor((b + 1) * size))
    out.push({
      at: slice[slice.length - 1].at,
      cpu: average(slice.map((pt) => pt.cpu)),
      mem: average(slice.map(mem)),
      tps: average(slice.map((pt) => pt.tps))
    })
  }
  return out
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

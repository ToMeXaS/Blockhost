import { describe, expect, it } from 'vitest'
import type { StatsPoint } from '../../../shared/types'
import {
  appendPoint,
  downsample,
  formatGb,
  MAX_POINTS,
  memPercent,
  mergePoints,
  polylineSegments,
  tpsHealth
} from './stats'

const MB = 1024 * 1024
const p = (at: number, over: Partial<StatsPoint> = {}): StatsPoint => ({
  at,
  cpu: 10,
  memBytes: 512 * MB,
  tps: 20,
  ...over
})

describe('tpsHealth', () => {
  it.each([
    [20, 'healthy'],
    [18, 'healthy'],
    [17.9, 'lagging'],
    [15, 'lagging'],
    [14.9, 'struggling']
  ] as const)('%d → %s', (tps, expected) => {
    expect(tpsHealth(tps)).toBe(expected)
  })
})

describe('formatGb / memPercent', () => {
  it('formats bytes as GB with one decimal', () => {
    expect(formatGb(7.44 * 1024 ** 3)).toBe('7.4')
    expect(formatGb(0)).toBe('0.0')
  })

  it('computes memory as a percent of the allocation', () => {
    expect(memPercent(512 * MB, 1024)).toBe(50)
    expect(memPercent(512 * MB, 0)).toBe(0)
  })
})

describe('downsample', () => {
  it('places points in time slots ending at `end`, leaving empty slots as gaps', () => {
    // 4 slots of 10ms over the 40ms ending at 100: (60,70] (70,80] (80,90] (90,100]
    expect(downsample([p(75), p(100, { memBytes: null })], 1024, 100, 4, 40)).toEqual([
      { at: 70, cpu: null, mem: null, tps: null },
      { at: 80, cpu: 10, mem: 50, tps: 20 },
      { at: 90, cpu: null, mem: null, tps: null },
      { at: 100, cpu: 10, mem: null, tps: 20 }
    ])
  })

  it('averages a slot, skipping nulls, and drops points outside the window', () => {
    const points = [
      p(50, { cpu: 90 }),
      p(91, { cpu: 10 }),
      p(95, { cpu: 30 }),
      p(99, { cpu: null, tps: null })
    ]
    expect(downsample(points, 1024, 100, 1, 10)).toEqual([{ at: 100, cpu: 20, mem: 50, tps: 20 }])
  })
})

describe('polylineSegments', () => {
  it('spreads points across the width and splits at gaps', () => {
    expect(polylineSegments([0, 50, null, 100, 100], (v) => 100 - v, 400)).toEqual([
      '0,100 100,50',
      '300,0 400,0'
    ])
  })

  it('returns nothing for all-null values', () => {
    expect(polylineSegments([null, null], (v) => v, 100)).toEqual([])
  })
})

describe('appendPoint / mergePoints', () => {
  it('appends and keeps at most an hour of points', () => {
    let points: StatsPoint[] = []
    for (let i = 0; i < MAX_POINTS + 5; i++) points = appendPoint(points, p(i))
    expect(points).toHaveLength(MAX_POINTS)
    expect(points[0].at).toBe(5)
  })

  it('adds live points newer than the snapshot', () => {
    expect(mergePoints([p(1), p(2)], [p(2), p(3)]).map((x) => x.at)).toEqual([1, 2, 3])
    expect(mergePoints([], [p(3)]).map((x) => x.at)).toEqual([3])
  })
})

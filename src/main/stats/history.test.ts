import { describe, expect, it } from 'vitest'
import type { StatsPoint } from '../../shared/types'
import { HISTORY_CAPACITY, StatsHistory } from './history'

const point = (at: number): StatsPoint => ({ at, cpu: 1, memBytes: 2, tps: 20 })

describe('StatsHistory', () => {
  it('holds an hour of 5 s points by default', () => {
    expect(HISTORY_CAPACITY).toBe(720)
  })

  it('returns points oldest first, per server', () => {
    const history = new StatsHistory()
    history.push('a', point(1))
    history.push('b', point(5))
    history.push('a', point(2))
    expect(history.points('a')).toEqual([point(1), point(2)])
    expect(history.points('b')).toEqual([point(5)])
    expect(history.points('missing')).toEqual([])
  })

  it('drops the oldest points past capacity', () => {
    const history = new StatsHistory(3)
    for (let i = 1; i <= 5; i++) history.push('a', point(i))
    expect(history.points('a').map((p) => p.at)).toEqual([3, 4, 5])
  })

  it('returns a copy and clears per server', () => {
    const history = new StatsHistory()
    history.push('a', point(1))
    history.points('a').push(point(9))
    expect(history.points('a')).toHaveLength(1)
    history.clear('a')
    expect(history.points('a')).toEqual([])
  })
})

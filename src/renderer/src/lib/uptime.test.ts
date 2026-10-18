import { describe, expect, it } from 'vitest'
import { nextRunningSince } from './uptime'

describe('nextRunningSince', () => {
  it('records the time a server becomes running', () => {
    expect(nextRunningSince({}, 'a', 'running', 1000)).toEqual({ a: 1000 })
  })

  it('keeps the first time while it stays running', () => {
    const prev = { a: 1000 }
    expect(nextRunningSince(prev, 'a', 'running', 5000)).toBe(prev)
  })

  it('forgets the time when the server leaves running', () => {
    expect(nextRunningSince({ a: 1000, b: 2000 }, 'a', 'stopping', 5000)).toEqual({ b: 2000 })
  })

  it('returns the same object when nothing changes', () => {
    const prev = { b: 2000 }
    expect(nextRunningSince(prev, 'a', 'stopped', 5000)).toBe(prev)
  })
})

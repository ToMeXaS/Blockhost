import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Batcher } from './batcher'

describe('Batcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('groups items pushed within the window', () => {
    const batches: number[][] = []
    const batcher = new Batcher<number>(50, (items) => batches.push(items))
    batcher.push(1)
    batcher.push(2)
    expect(batches).toEqual([])
    vi.advanceTimersByTime(50)
    expect(batches).toEqual([[1, 2]])
    batcher.push(3)
    vi.advanceTimersByTime(50)
    expect(batches).toEqual([[1, 2], [3]])
  })

  it('flush() emits immediately and does nothing when empty', () => {
    const batches: number[][] = []
    const batcher = new Batcher<number>(50, (items) => batches.push(items))
    batcher.flush()
    batcher.push(7)
    batcher.flush()
    vi.advanceTimersByTime(100)
    expect(batches).toEqual([[7]])
  })
})

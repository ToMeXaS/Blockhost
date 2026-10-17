import { describe, expect, it } from 'vitest'
import { JsonCache } from './cache'
import { tempDir } from './test-utils'

describe('JsonCache', () => {
  it('returns fresh values, expires them, and keeps stale copies', async () => {
    let now = 1_000
    const cache = new JsonCache(await tempDir(), () => now)
    await cache.set('https://x.test/a', { a: 1 })
    expect(await cache.getFresh('https://x.test/a', 500)).toEqual({ a: 1 })
    now = 2_000
    expect(await cache.getFresh('https://x.test/a', 500)).toBeUndefined()
    expect(await cache.getStale('https://x.test/a')).toEqual({ a: 1 })
  })

  it('returns undefined for unknown keys', async () => {
    const cache = new JsonCache(await tempDir())
    expect(await cache.getFresh('missing', 1000)).toBeUndefined()
    expect(await cache.getStale('missing')).toBeUndefined()
  })
})

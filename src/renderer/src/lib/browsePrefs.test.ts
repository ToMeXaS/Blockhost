import { describe, expect, it } from 'vitest'
import { loadPrefs, savePrefs } from './browsePrefs'

const mem = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v)
  }
}

describe('browse prefs', () => {
  it('defaults and round-trips per server', () => {
    const s = mem()
    expect(loadPrefs('a', s)).toEqual({ sources: null, category: null, sort: 'relevance' })
    savePrefs('a', { sources: ['hangar'], category: 'chat', sort: 'downloads' }, s)
    expect(loadPrefs('a', s)).toEqual({ sources: ['hangar'], category: 'chat', sort: 'downloads' })
    expect(loadPrefs('b', s).sources).toBeNull()
  })

  it('ignores junk and storage failures', () => {
    expect(
      loadPrefs('a', { getItem: () => '{"sources":["curse"],"category":"x","sort":"y"}' })
    ).toEqual({ sources: [], category: null, sort: 'relevance' })
    expect(
      loadPrefs('a', {
        getItem: () => {
          throw new Error('blocked')
        }
      }).sort
    ).toBe('relevance')
    expect(() =>
      savePrefs(
        'a',
        { sources: null, category: null, sort: 'relevance' },
        {
          setItem: () => {
            throw new Error('full')
          }
        }
      )
    ).not.toThrow()
  })
})

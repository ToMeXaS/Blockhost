import { describe, expect, it } from 'vitest'
import { CONTENT_CATEGORIES } from '../../../shared/types'
import { createContentProviders } from './index'

describe('createContentProviders', () => {
  it('lists providers in interleave order', () => {
    expect(createContentProviders({ userAgent: 'x' }).map((p) => p.id)).toEqual([
      'modrinth',
      'hangar',
      'spigot'
    ])
  })

  it('maps every category in at least one provider', () => {
    const providers = createContentProviders({ userAgent: 'x' })
    for (const c of CONTENT_CATEGORIES) {
      expect(
        providers.some((p) => p.categories[c]?.length),
        c
      ).toBe(true)
    }
  })
})

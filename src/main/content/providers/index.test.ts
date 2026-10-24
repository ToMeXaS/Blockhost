import { describe, expect, it } from 'vitest'
import { createContentProviders } from './index'

describe('createContentProviders', () => {
  it('lists providers in interleave order', () => {
    expect(createContentProviders({ userAgent: 'x' }).map((p) => p.id)).toEqual([
      'modrinth',
      'hangar'
    ])
  })
})

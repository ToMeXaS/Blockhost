import { describe, expect, it } from 'vitest'
import {
  countChanges,
  groupProperties,
  matchesQuery,
  PROPERTY_CATALOG,
  PROPERTY_CATEGORIES
} from './propertyCatalog'

const rows = (groups: ReturnType<typeof groupProperties>, id: string): string[] =>
  groups.find((g) => g.id === id)?.rows.map((r) => r.key) ?? []

describe('PROPERTY_CATALOG', () => {
  it('has unique keys', () => {
    const keys = PROPERTY_CATALOG.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('has defaults that fit each kind', () => {
    for (const def of PROPERTY_CATALOG) {
      if (def.kind === 'bool') expect(['true', 'false'], def.key).toContain(def.default)
      if (def.kind === 'select') expect(def.options, def.key).toContain(def.default)
      if (def.kind === 'number') {
        const n = Number(def.default)
        expect(Number.isFinite(n), def.key).toBe(true)
        if (def.min !== undefined) expect(n, def.key).toBeGreaterThanOrEqual(def.min)
        if (def.max !== undefined) expect(n, def.key).toBeLessThanOrEqual(def.max)
      }
    }
  })

  it('only uses known categories', () => {
    const ids = new Set(PROPERTY_CATEGORIES.map((c) => c.id))
    for (const def of PROPERTY_CATALOG) expect(ids.has(def.category), def.key).toBe(true)
  })
})

describe('matchesQuery', () => {
  it('matches any field case-insensitively and treats blank as match-all', () => {
    expect(matchesQuery('', 'x')).toBe(true)
    expect(matchesQuery('  PVP ', 'Player vs player', 'pvp')).toBe(true)
    expect(matchesQuery('seed', 'Max players', undefined)).toBe(false)
  })
})

describe('groupProperties', () => {
  const generated = [
    { key: 'motd', value: 'Hi' },
    { key: 'pvp', value: 'false' },
    { key: 'spawn-protection', value: '16' },
    { key: 'custom-plugin-key', value: 'x' }
  ]

  it('places known keys in their category and unknown keys in Other', () => {
    const groups = groupProperties(generated)
    expect(rows(groups, 'players')).toContain('motd')
    expect(rows(groups, 'gameplay')).toContain('pvp')
    expect(rows(groups, 'other')).toEqual(['custom-plugin-key'])
    expect(groups.map((g) => g.id)).toEqual(PROPERTY_CATEGORIES.map((c) => c.id))
  })

  it('shows only keys present once the file is generated', () => {
    const all = groupProperties(generated).flatMap((g) => g.rows.map((r) => r.key))
    expect(all).not.toContain('max-players')
  })

  it('shows core keys with defaults before the file is generated', () => {
    const groups = groupProperties([{ key: 'server-port', value: '25570' }])
    const maxPlayers = groups.flatMap((g) => g.rows).find((r) => r.key === 'max-players')
    expect(maxPlayers?.value).toBe('20')
    expect(groups.flatMap((g) => g.rows).some((r) => r.key === 'spawn-protection')).toBe(false)
  })

  it('filters by label, key, description, and unknown key/value', () => {
    const groups = groupProperties(generated, 'protect')
    expect(groups.flatMap((g) => g.rows.map((r) => r.key))).toEqual(['spawn-protection'])
    expect(rows(groupProperties(generated, 'plugin'), 'other')).toEqual(['custom-plugin-key'])
  })
})

describe('countChanges', () => {
  it('counts changed, added and removed keys', () => {
    const saved = [
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
      { key: 'c', value: '3' }
    ]
    const current = [
      { key: 'a', value: '1' },
      { key: 'b', value: '9' },
      { key: 'd', value: '4' }
    ]
    expect(countChanges(saved, current)).toBe(3)
    expect(countChanges(saved, saved)).toBe(0)
  })
})

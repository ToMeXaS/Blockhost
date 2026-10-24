import { describe, expect, it } from 'vitest'
import type { InstalledContent } from '../../../shared/types'
import { countFor, filterInstalled } from './contentFilters'

const item = (p: Partial<InstalledContent> & { title: string }): InstalledContent => ({
  fileName: `${p.title}.jar`,
  versionNumber: '1',
  source: 'modrinth',
  iconUrl: null,
  disabled: false,
  isDependency: false,
  installedAt: '2026-01-01T00:00:00.000Z',
  neededBy: [],
  ...p
})

const items = [
  item({
    title: 'Beta',
    installedAt: '2026-03-01T00:00:00.000Z',
    update: { versionId: 'x', versionNumber: '2' }
  }),
  item({ title: 'alpha', disabled: true }),
  item({ title: 'Hand', source: 'manual', installedAt: null })
]

describe('filterInstalled', () => {
  it('filters by chip and text, case-insensitively', () => {
    expect(
      filterInstalled(items, { filter: 'all', sort: 'name', text: '' }).map((i) => i.title)
    ).toEqual(['alpha', 'Beta', 'Hand'])
    expect(
      filterInstalled(items, { filter: 'updates', sort: 'name', text: '' }).map((i) => i.title)
    ).toEqual(['Beta'])
    expect(
      filterInstalled(items, { filter: 'disabled', sort: 'name', text: '' }).map((i) => i.title)
    ).toEqual(['alpha'])
    expect(
      filterInstalled(items, { filter: 'manual', sort: 'name', text: '' }).map((i) => i.title)
    ).toEqual(['Hand'])
    expect(
      filterInstalled(items, { filter: 'all', sort: 'name', text: 'AN' }).map((i) => i.title)
    ).toEqual(['Hand'])
  })

  it('sorts by most recently installed, unknown dates last', () => {
    expect(
      filterInstalled(items, { filter: 'all', sort: 'recent', text: '' }).map((i) => i.title)
    ).toEqual(['Beta', 'alpha', 'Hand'])
  })

  it('counts per chip', () => {
    expect(countFor(items, 'updates')).toBe(1)
    expect(countFor(items, 'all')).toBe(3)
  })
})

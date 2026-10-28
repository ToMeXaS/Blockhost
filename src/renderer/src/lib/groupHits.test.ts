import { describe, expect, it } from 'vitest'
import type { ContentSearchHit } from '../../../shared/types'
import { groupHits, titleKey } from './groupHits'

const hit = (
  source: ContentSearchHit['source'],
  title: string,
  p: Partial<ContentSearchHit> = {}
): ContentSearchHit => ({
  source,
  projectId: `${source}-${title}`,
  slug: title,
  title,
  author: null,
  description: '',
  iconUrl: null,
  downloads: 10,
  updatedAt: null,
  untestedOnVersion: false,
  installed: false,
  ...p
})

describe('titleKey', () => {
  it('ignores case, punctuation, bracketed notes and taglines', () => {
    expect(titleKey('LuckPerms')).toBe('luckperms')
    expect(titleKey('LuckPerms [1.8 - 1.21]')).toBe('luckperms')
    expect(titleKey('Luck-Perms (Bukkit)')).toBe('luckperms')
    expect(titleKey('LuckPerms | A permissions plugin')).toBe('luckperms')
  })
})

describe('groupHits', () => {
  it('merges one project across sources, keeping the first-ranked listing as primary', () => {
    const groups = groupHits([
      hit('modrinth', 'LuckPerms'),
      hit('hangar', 'Vault'),
      hit('spigot', 'LuckPerms [1.8-1.21]', { downloads: 5 })
    ])
    expect(groups.map((g) => g.primary.title)).toEqual(['LuckPerms', 'Vault'])
    expect(groups[0].hits.map((h) => h.source)).toEqual(['modrinth', 'spigot'])
    expect(groups[0].downloads).toBe(15)
    expect(groups[0].key).toBe('modrinth:modrinth-LuckPerms')
  })

  it('is installed when any listing is installed', () => {
    const [g] = groupHits([hit('modrinth', 'Vault'), hit('spigot', 'Vault', { installed: true })])
    expect(g.installed).toBe(true)
  })

  it('keeps same-named projects from one source apart', () => {
    const groups = groupHits([
      hit('spigot', 'Chat', { projectId: '1' }),
      hit('spigot', 'Chat', { projectId: '2' }),
      hit('modrinth', 'Chat')
    ])
    expect(groups.map((g) => g.hits.length)).toEqual([2, 1])
  })

  it('keeps same-titled projects by different authors apart', () => {
    const groups = groupHits([
      hit('modrinth', 'Graves', { author: 'alice' }),
      hit('hangar', 'Graves', { author: 'bob' })
    ])
    expect(groups).toHaveLength(2)
  })

  it('merges when the authors match loosely or one is unknown', () => {
    const groups = groupHits([
      hit('modrinth', 'LuckPerms', { author: 'Luck' }),
      hit('hangar', 'LuckPerms', { author: 'luck' }),
      hit('spigot', 'LuckPerms', { author: null })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].hits).toHaveLength(3)
  })

  it('joins a later listing to the group whose author matches', () => {
    const groups = groupHits([
      hit('modrinth', 'Graves', { author: 'alice' }),
      hit('modrinth', 'Graves', { author: 'bob', projectId: 'm2' }),
      hit('hangar', 'Graves', { author: 'bob' })
    ])
    expect(groups.map((g) => g.hits.length)).toEqual([1, 2])
  })

  it('does not merge titles with nothing comparable left', () => {
    expect(groupHits([hit('modrinth', '[ ]'), hit('spigot', '[ ]')])).toHaveLength(2)
  })
})

import { describe, expect, it } from 'vitest'
import { CONTENT_LABELS, SERVER_TYPES } from '../../shared/types'
import { contentTarget } from './loaders'

describe('contentTarget', () => {
  it('maps every server type', () => {
    expect(contentTarget('fabric')).toEqual({
      folder: 'mods',
      loaders: ['fabric'],
      projectType: 'mod',
      label: 'Mods'
    })
    expect(contentTarget('forge')).toEqual({
      folder: 'mods',
      loaders: ['forge'],
      projectType: 'mod',
      label: 'Mods'
    })
    expect(contentTarget('neoforge')).toEqual({
      folder: 'mods',
      loaders: ['neoforge'],
      projectType: 'mod',
      label: 'Mods'
    })
    expect(contentTarget('paper')).toEqual({
      folder: 'plugins',
      loaders: ['paper', 'spigot', 'bukkit'],
      projectType: 'plugin',
      label: 'Plugins'
    })
    expect(contentTarget('purpur')).toEqual({
      folder: 'plugins',
      loaders: ['purpur', 'paper', 'spigot', 'bukkit'],
      projectType: 'plugin',
      label: 'Plugins'
    })
    expect(contentTarget('vanilla')).toBeNull()
  })

  it('agrees with the shared labels and returns copies', () => {
    for (const type of SERVER_TYPES)
      expect(contentTarget(type)?.label ?? null).toBe(CONTENT_LABELS[type])
    contentTarget('paper')!.loaders.push('x')
    expect(contentTarget('paper')!.loaders).toEqual(['paper', 'spigot', 'bukkit'])
  })
})

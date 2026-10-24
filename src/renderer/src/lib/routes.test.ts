import { describe, expect, it } from 'vitest'
import { resolveSection, sectionsFor } from './routes'

describe('sectionsFor', () => {
  it('hides the content section for Vanilla', () => {
    expect(sectionsFor('vanilla').map((s) => s.id)).toEqual([
      'overview',
      'console',
      'players',
      'properties',
      'backups',
      'connect',
      'settings'
    ])
  })

  it('labels the content section Plugins for Paper and Mods for Fabric', () => {
    expect(sectionsFor('paper').find((s) => s.id === 'content')?.label).toBe('Plugins')
    expect(sectionsFor('fabric').find((s) => s.id === 'content')?.label).toBe('Mods')
  })

  it('keeps the sidebar order', () => {
    expect(sectionsFor('neoforge').map((s) => s.label)).toEqual([
      'Dashboard',
      'Console',
      'Players',
      'Mods',
      'Config',
      'Backups',
      'Connect',
      'Settings'
    ])
  })
})

describe('resolveSection', () => {
  it('defaults to overview', () => {
    expect(resolveSection('paper')).toBe('overview')
  })

  it('keeps a remembered section the server has', () => {
    expect(resolveSection('paper', 'content')).toBe('content')
    expect(resolveSection('vanilla', 'console')).toBe('console')
  })

  it('falls back to overview when the server has no such section', () => {
    expect(resolveSection('vanilla', 'content')).toBe('overview')
  })
})

import { describe, expect, it } from 'vitest'
import type { ConfigNode } from '../../../shared/types'
import { GENERAL_SECTION, nodeText, pathKey, yamlSections } from './yamlTree'

const NODES: ConfigNode[] = [
  { path: ['verbose'], kind: 'bool', value: false },
  { path: ['settings'], kind: 'map', comment: 'Core settings' },
  { path: ['settings', 'allow-end'], kind: 'bool', value: true, comment: 'Allow the End' },
  { path: ['settings', 'chunk-gc'], kind: 'map' },
  { path: ['settings', 'chunk-gc', 'period-in-ticks'], kind: 'number', value: 600, source: '600' },
  { path: ['settings', 'aliases'], kind: 'list', value: ['a', 'b'] },
  { path: ['empty'], kind: 'map' }
]

describe('yamlSections', () => {
  it('builds one section per top-level map plus General, grouping by parent path', () => {
    const sections = yamlSections(NODES)
    expect(sections.map((s) => [s.id, s.label, s.count])).toEqual([
      [GENERAL_SECTION, 'General', 1],
      ['settings', 'settings', 3]
    ])
    expect(sections[1].description).toBe('Core settings')
    expect(sections[1].groups.map((g) => [g.parent, g.nodes.map((n) => n.path.at(-1))])).toEqual([
      ['', ['allow-end', 'aliases']],
      ['chunk-gc', ['period-in-ticks']]
    ])
  })

  it('filters by path, value and comment', () => {
    expect(
      yamlSections(NODES, 'period').flatMap((s) => s.groups.flatMap((g) => g.nodes))
    ).toHaveLength(1)
    expect(yamlSections(NODES, 'the end')[0].groups[0].nodes[0].path).toEqual([
      'settings',
      'allow-end'
    ])
    expect(yamlSections(NODES, 'a, b')[0].groups[0].nodes[0].path).toEqual(['settings', 'aliases'])
    expect(yamlSections(NODES, 'zzz')).toEqual([])
  })

  it('matches edited values instead of saved ones', () => {
    const edits = new Map([[pathKey(['verbose']), true]])
    expect(yamlSections(NODES, 'true', edits).map((s) => s.id)).toContain(GENERAL_SECTION)
  })
})

describe('nodeText', () => {
  it('renders values for display and search', () => {
    expect(nodeText(['a', 'b'])).toBe('a, b')
    expect(nodeText(false)).toBe('false')
    expect(nodeText(undefined)).toBe('')
  })
})

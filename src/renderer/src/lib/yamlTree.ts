import type { ConfigNode, ConfigValue } from '../../../shared/types'
import { matchesQuery } from './propertyCatalog'

export const GENERAL_SECTION = '__general'

export interface YamlGroup {
  /** Dotted path below the section key; '' for the section's direct children. */
  parent: string
  nodes: ConfigNode[]
}

export interface YamlSection {
  id: string
  label: string
  description?: string
  groups: YamlGroup[]
  count: number
}

export const pathKey = (path: string[]): string => JSON.stringify(path)

export function nodeText(value: ConfigValue | undefined): string {
  return Array.isArray(value) ? value.join(', ') : String(value ?? '')
}

/**
 * One section per top-level map (plus General for top-level values), each grouping its
 * editable keys by parent path. Sections with no matching keys are dropped.
 */
export function yamlSections(
  nodes: ConfigNode[],
  query = '',
  values: Map<string, ConfigValue> = new Map()
): YamlSection[] {
  const sections = new Map<string, YamlSection>()
  for (const node of nodes) {
    if (node.path.length !== 1) continue
    const id = node.kind === 'map' ? node.path[0] : GENERAL_SECTION
    if (sections.has(id)) continue
    sections.set(
      id,
      node.kind === 'map'
        ? { id, label: id, description: node.comment, groups: [], count: 0 }
        : { id, label: 'General', groups: [], count: 0 }
    )
  }
  for (const node of nodes) {
    if (node.kind === 'map') continue
    const value = values.get(pathKey(node.path)) ?? node.value
    if (!matchesQuery(query, node.path.join('.'), nodeText(value), node.comment)) continue
    const section = sections.get(node.path.length === 1 ? GENERAL_SECTION : node.path[0])
    if (!section) continue
    const parent = node.path.slice(1, -1).join('.')
    let group = section.groups.find((g) => g.parent === parent)
    if (!group) {
      group = { parent, nodes: [] }
      section.groups.push(group)
    }
    group.nodes.push(node)
    section.count++
  }
  return [...sections.values()].filter((s) => s.count > 0)
}

import { CONTENT_LABELS, type ServerType } from '../../../shared/types'

export type Section =
  'overview' | 'console' | 'players' | 'content' | 'properties' | 'connect' | 'settings'

export interface SectionInfo {
  id: Section
  label: string
}

const ORDER: Section[] = [
  'overview',
  'console',
  'players',
  'content',
  'properties',
  'connect',
  'settings'
]

const LABELS: Record<Exclude<Section, 'content'>, string> = {
  overview: 'Overview',
  console: 'Console',
  players: 'Players',
  properties: 'Properties',
  connect: 'Connect',
  settings: 'Settings'
}

/** The sidebar sections a server of this type has, in order. */
export function sectionsFor(type: ServerType): SectionInfo[] {
  const contentLabel = CONTENT_LABELS[type]
  return ORDER.flatMap((id): SectionInfo[] => {
    if (id !== 'content') return [{ id, label: LABELS[id] }]
    return contentLabel ? [{ id, label: contentLabel }] : []
  })
}

/** The remembered section if this server type has it, otherwise Overview. */
export function resolveSection(type: ServerType, remembered?: Section): Section {
  if (!remembered) return 'overview'
  return sectionsFor(type).some((s) => s.id === remembered) ? remembered : 'overview'
}

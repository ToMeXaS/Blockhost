import type { ContentLabel, ServerType } from '../../shared/types'

export interface ContentTarget {
  folder: 'mods' | 'plugins'
  /** Modrinth loader names accepted by this server, most specific first. */
  loaders: string[]
  projectType: 'mod' | 'plugin'
  label: ContentLabel
}

const MODS = (loader: string): ContentTarget => ({
  folder: 'mods',
  loaders: [loader],
  projectType: 'mod',
  label: 'Mods'
})

const TARGETS: Record<ServerType, ContentTarget | null> = {
  vanilla: null,
  fabric: MODS('fabric'),
  forge: MODS('forge'),
  neoforge: MODS('neoforge'),
  paper: {
    folder: 'plugins',
    loaders: ['paper', 'spigot', 'bukkit'],
    projectType: 'plugin',
    label: 'Plugins'
  },
  purpur: {
    folder: 'plugins',
    loaders: ['purpur', 'paper', 'spigot', 'bukkit'],
    projectType: 'plugin',
    label: 'Plugins'
  }
}

export function contentTarget(type: ServerType): ContentTarget | null {
  const target = TARGETS[type]
  return target ? { ...target, loaders: [...target.loaders] } : null
}

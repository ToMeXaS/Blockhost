import type { InstalledContent } from '../../../shared/types'

export type InstalledFilter = 'all' | 'updates' | 'disabled' | 'manual'
export type InstalledSort = 'name' | 'recent'

const MATCHES: Record<InstalledFilter, (i: InstalledContent) => boolean> = {
  all: () => true,
  updates: (i) => Boolean(i.update),
  disabled: (i) => i.disabled,
  manual: (i) => i.source === 'manual'
}

export const countFor = (items: InstalledContent[], filter: InstalledFilter): number =>
  items.filter(MATCHES[filter]).length

export function filterInstalled(
  items: InstalledContent[],
  opts: { filter: InstalledFilter; sort: InstalledSort; text: string }
): InstalledContent[] {
  const needle = opts.text.trim().toLowerCase()
  const out = items.filter(
    (i) =>
      MATCHES[opts.filter](i) &&
      (!needle ||
        i.title.toLowerCase().includes(needle) ||
        i.fileName.toLowerCase().includes(needle))
  )
  const byName = (a: InstalledContent, b: InstalledContent): number =>
    a.title.toLowerCase().localeCompare(b.title.toLowerCase())
  return out.sort(
    opts.sort === 'name'
      ? byName
      : (a, b) => (b.installedAt ?? '').localeCompare(a.installedAt ?? '') || byName(a, b)
  )
}

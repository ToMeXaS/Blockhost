import { useEffect, useState } from 'react'
import { inputClass } from '../../../components/ui'

export interface RailItem {
  id: string
  label: string
  count: number
}

export function scrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Id of the first section whose top is in the upper part of the viewport. */
export function useScrollSpy(ids: string[]): string | undefined {
  const [active, setActive] = useState<string>()
  const key = ids.join('|')
  useEffect(() => {
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        const first = ids.find((id) => visible.has(id))
        if (first) setActive(first)
      },
      { rootMargin: '0px 0px -60% 0px' }
    )
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
    // ids is captured through key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return active && ids.includes(active) ? active : ids[0]
}

export function ConfigRail({
  query,
  onQuery,
  placeholder,
  items,
  active,
  onSelect
}: {
  query: string
  onQuery: (query: string) => void
  placeholder: string
  items: RailItem[]
  active: string | undefined
  onSelect: (id: string) => void
}) {
  return (
    <nav className="sticky top-4 space-y-3 self-start" aria-label="Sections">
      <input
        type="search"
        className={inputClass}
        placeholder={placeholder}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={item.id === active ? 'true' : undefined}
              className={`flex w-full items-center justify-between gap-2 rounded-btn px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                item.id === active
                  ? 'bg-nav-active text-text'
                  : 'text-muted hover:bg-panel-2/60 hover:text-text'
              }`}
            >
              <span className="truncate">{item.label}</span>
              <span className="shrink-0 text-xs text-faint">{item.count}</span>
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="px-2.5 py-1.5 text-xs text-faint">No matches</li>}
      </ul>
    </nav>
  )
}

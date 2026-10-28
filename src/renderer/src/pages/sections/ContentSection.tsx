import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  CONTENT_LABELS,
  type ContentRef,
  type ContentSearchHit,
  type ContentSource,
  type ServerView
} from '../../../../shared/types'
import { Notice } from '../../components/ui'
import { api } from '../../lib/api'
import { BrowsePanel } from './content/BrowsePanel'
import { InstalledList } from './content/InstalledList'
import { ProjectDetail } from './content/ProjectDetail'

// The page scrolls inside an ancestor (ServerPage's overflow-auto wrapper), not the window.
function findScroller(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p
  }
  return null
}

export function ContentSection({ server }: { server: ServerView }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const savedScroll = useRef(0)
  const [lastInstalled, setLastInstalled] = useState<ContentRef | null>(null)
  const [open, setOpen] = useState<{ ref: ContentRef; hit?: ContentSearchHit } | null>(null)
  const label = CONTENT_LABELS[server.type] ?? 'Mods'
  const noun = label === 'Plugins' ? 'plugins' : 'mods'
  const [available, setAvailable] = useState<{ source: ContentSource; label: string }[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [tab, setTab] = useState<'installed' | 'browse'>('installed')
  const [counts, setCounts] = useState<{ total: number; updates: number } | null>(null)

  useEffect(() => {
    void api.contentSources(server.id).then(setAvailable, () => setAvailable([]))
  }, [server.id])
  useEffect(() => {
    if (server.status !== 'running') setRestartNeeded(false)
  }, [server.status])

  const installed = (restart: boolean) => {
    setRefreshKey((k) => k + 1)
    if (restart) setRestartNeeded(true)
  }

  // The ref is built once when opening, so ProjectDetail's effects don't re-run each render.
  const openProject = (ref: ContentRef, hit?: ContentSearchHit) => {
    savedScroll.current = findScroller(rootRef.current)?.scrollTop ?? 0
    setOpen({ ref, hit })
  }
  const closeProject = () => setOpen(null)

  // Restore the list's scroll once it is visible again.
  useLayoutEffect(() => {
    if (open) {
      const scroller = findScroller(rootRef.current)
      if (scroller) scroller.scrollTop = 0
    } else {
      const scroller = findScroller(rootRef.current)
      if (scroller) scroller.scrollTop = savedScroll.current
    }
  }, [open])

  return (
    <div ref={rootRef} className="space-y-4">
      {restartNeeded && server.status === 'running' && (
        <Notice tone="warn">Restart the server to apply changes.</Notice>
      )}
      {open && (
        <ProjectDetail
          server={server}
          projectRef={open.ref}
          fallback={open.hit}
          onBack={closeProject}
          onChanged={(restart, ref) => {
            setLastInstalled({ ...ref })
            installed(restart)
          }}
        />
      )}
      <div className={open ? 'hidden' : 'space-y-4'}>
        {available.length > 0 && (
          <div role="tablist" aria-label={label} className="flex gap-1 border-b border-border">
            {(['installed', 'browse'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`-mb-px flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors ${
                  tab === t
                    ? 'border-accent text-text'
                    : 'border-transparent text-muted hover:text-text'
                }`}
              >
                {t === 'installed' ? 'Installed' : `Browse ${noun}`}
                {t === 'installed' && counts && (
                  <span className="rounded-sm bg-panel-2 px-1.5 font-mono text-xs text-muted">
                    {counts.total}
                  </span>
                )}
                {t === 'installed' && counts && counts.updates > 0 && (
                  <span className="rounded-sm bg-warn-bg px-1.5 text-xs text-warn">
                    {counts.updates} {counts.updates === 1 ? 'update' : 'updates'}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        <div className={tab === 'installed' || !available.length ? '' : 'hidden'}>
          <InstalledList
            server={server}
            noun={noun}
            refreshKey={refreshKey}
            onOpenProject={(ref) => openProject(ref)}
            onCounts={setCounts}
            onBrowse={available.length ? () => setTab('browse') : undefined}
          />
        </div>
        {available.length > 0 && (
          <div className={tab === 'browse' ? '' : 'hidden'}>
            <BrowsePanel
              server={server}
              noun={noun}
              available={available}
              onOpen={(hit) => openProject({ source: hit.source, projectId: hit.projectId }, hit)}
              onInstalled={installed}
              installedRef={lastInstalled}
            />
          </div>
        )}
      </div>
    </div>
  )
}

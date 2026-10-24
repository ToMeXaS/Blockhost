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
  const [open, setOpen] = useState<{ ref: ContentRef; hit?: ContentSearchHit } | null>(null)
  const label = CONTENT_LABELS[server.type] ?? 'Mods'
  const noun = label === 'Plugins' ? 'plugins' : 'mods'
  const [available, setAvailable] = useState<{ source: ContentSource; label: string }[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [restartNeeded, setRestartNeeded] = useState(false)

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
          onChanged={installed}
        />
      )}
      <div className={open ? 'hidden' : 'space-y-4'}>
        <InstalledList
          server={server}
          noun={noun}
          refreshKey={refreshKey}
          onOpenProject={(ref) => openProject(ref)}
        />
        {available.length > 0 && (
          <BrowsePanel
            server={server}
            noun={noun}
            available={available}
            onOpen={(hit) => openProject({ source: hit.source, projectId: hit.projectId }, hit)}
            onInstalled={installed}
          />
        )}
      </div>
    </div>
  )
}

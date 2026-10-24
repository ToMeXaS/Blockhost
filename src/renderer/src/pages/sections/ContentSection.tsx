import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CONTENT_LABELS,
  type ContentCursor,
  type ContentSearchHit,
  type ServerView
} from '../../../../shared/types'
import { Badge, Button, Card, ErrorText, inputClass, Notice } from '../../components/ui'
import { useToast } from '../../components/Toaster'
import { api, errorMessage } from '../../lib/api'
import { InstalledList } from './content/InstalledList'

const SEARCH_DEBOUNCE_MS = 300

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export function ContentSection({ server }: { server: ServerView }) {
  const label = CONTENT_LABELS[server.type] ?? 'Mods'
  const noun = label === 'Plugins' ? 'plugins' : 'mods'
  const toast = useToast()
  const [refreshKey, setRefreshKey] = useState(0)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ContentSearchHit[]>([])
  const [cursor, setCursor] = useState<ContentCursor | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const searchSeq = useRef(0)
  // The query behind the results on screen, so "Load more" never mixes in a pending one.
  const shownQuery = useRef('')

  useEffect(() => {
    if (server.status !== 'running') setRestartNeeded(false)
  }, [server.status])

  const runSearch = useCallback(
    async (q: string, at: ContentCursor | null) => {
      const seq = ++searchSeq.current
      setSearching(true)
      setSearchError(null)
      try {
        const r = await api.contentSearch(server.id, {
          text: q,
          sources: ['modrinth'],
          category: null,
          sort: 'relevance',
          cursor: at
        })
        if (seq !== searchSeq.current) return
        if (at === null) shownQuery.current = q
        setHits((prev) => (at === null ? r.hits : [...prev, ...r.hits]))
        setCursor(r.cursor)
      } catch (err) {
        if (seq === searchSeq.current) setSearchError(errorMessage(err))
      } finally {
        if (seq === searchSeq.current) setSearching(false)
      }
    },
    [server.id]
  )
  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query.trim(), null), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, runSearch])

  async function act(key: string, action: () => Promise<void>) {
    setBusy(key)
    try {
      await action()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const install = (hit: ContentSearchHit) =>
    act(hit.projectId, async () => {
      const r = await api.contentInstall(server.id, {
        source: hit.source,
        projectId: hit.projectId
      })
      const [main, ...deps] = r.installed
      if (main) {
        const extra = deps.map((d) => `${d.title} (dependency)`).join(', ')
        toast.success(`Installed ${main.title}${deps.length ? ` + ${extra}` : ''}.`)
      } else {
        toast.info(`${hit.title} is already installed.`)
      }
      if (r.restartNeeded) setRestartNeeded(true)
      setHits((prev) =>
        prev.map((h) => (h.projectId === hit.projectId ? { ...h, installed: true } : h))
      )
      setRefreshKey((k) => k + 1)
    })

  return (
    <div className="space-y-4">
      {restartNeeded && server.status === 'running' && (
        <Notice tone="warn">Restart the server to apply changes.</Notice>
      )}

      <InstalledList server={server} noun={noun} refreshKey={refreshKey} onOpenProject={() => {}} />

      <Card title={`Browse ${noun} on Modrinth`}>
        <div className="space-y-3">
          <label className="block">
            <span className="sr-only">Search {noun}</span>
            <input
              type="search"
              className={inputClass}
              placeholder={`Search ${noun} for ${server.mcVersion}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {searchError ? (
            <div className="flex items-center gap-3 text-sm text-muted">
              <ErrorText>{searchError}</ErrorText>
              <Button size="sm" variant="ghost" onClick={() => void runSearch(query.trim(), null)}>
                Retry
              </Button>
            </div>
          ) : (
            <>
              {!searching && hits.length === 0 && (
                <p className="text-sm text-faint">No {noun} found for this server.</p>
              )}
              <ul className="divide-y divide-border-soft">
                {hits.map((hit) => (
                  <li key={hit.projectId} className="flex items-center gap-3 py-2">
                    {hit.iconUrl ? (
                      <img
                        src={hit.iconUrl}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-btn bg-panel-2"
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="h-10 w-10 shrink-0 rounded-btn bg-panel-2"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-text">{hit.title}</div>
                      <div className="line-clamp-2 text-[13px] text-muted">{hit.description}</div>
                    </div>
                    <span className="shrink-0 font-mono text-xs text-faint">
                      {formatDownloads(hit.downloads)} downloads
                    </span>
                    {hit.installed ? (
                      <Badge tone="accent">Installed</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy !== null}
                        onClick={() => void install(hit)}
                      >
                        {busy === hit.projectId ? 'Installing…' : 'Install'}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {searching && <p className="text-sm text-faint">Searching…</p>}
              {!searching && cursor !== null && (
                <Button
                  className="w-full"
                  onClick={() => void runSearch(shownQuery.current, cursor)}
                >
                  Load more
                </Button>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CONTENT_LABELS,
  type ContentSearchHit,
  type InstalledContent,
  type InstalledContentList,
  type ServerView
} from '../../../../shared/types'
import { Button, ErrorText, inputClass } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'

const SEARCH_DEBOUNCE_MS = 300

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-md border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  )
}

export function ContentTab({ server }: { server: ServerView }) {
  const label = CONTENT_LABELS[server.type] ?? 'Mods'
  const noun = label === 'Plugins' ? 'plugins' : 'mods'
  const locked =
    server.status === 'starting' || server.status === 'running' || server.status === 'stopping'

  const [installed, setInstalled] = useState<InstalledContentList | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ContentSearchHit[]>([])
  const [total, setTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const searchSeq = useRef(0)

  const loadInstalled = useCallback(() => {
    api
      .contentInstalled(server.id)
      .then(setInstalled)
      .catch((err) => setError(errorMessage(err)))
  }, [server.id])
  useEffect(() => loadInstalled(), [loadInstalled])

  const runSearch = useCallback(
    async (q: string, offset: number) => {
      const seq = ++searchSeq.current
      setSearching(true)
      setSearchError(null)
      try {
        const r = await api.contentSearch(server.id, q, offset)
        if (seq !== searchSeq.current) return
        setHits((prev) => (offset === 0 ? r.hits : [...prev, ...r.hits]))
        setTotal(r.total)
      } catch (err) {
        if (seq === searchSeq.current) setSearchError(errorMessage(err))
      } finally {
        if (seq === searchSeq.current) setSearching(false)
      }
    },
    [server.id]
  )
  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query.trim(), 0), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, runSearch])

  async function act(key: string, action: () => Promise<void>) {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const install = (hit: ContentSearchHit) =>
    act(hit.projectId, async () => {
      const r = await api.contentInstall(server.id, hit.projectId)
      const [main, ...deps] = r.installed
      setNotice(
        main
          ? `Installed ${main.title}${deps.length ? ` + ${deps.map((d) => `${d.title} (dependency)`).join(', ')}` : ''}.`
          : `${hit.title} is already installed.`
      )
      if (r.restartNeeded) setRestartNeeded(true)
      setHits((prev) =>
        prev.map((h) => (h.projectId === hit.projectId ? { ...h, installed: true } : h))
      )
      loadInstalled()
    })

  const update = (item: InstalledContent) =>
    act(item.fileName, async () => {
      const r = await api.contentUpdate(server.id, item.fileName)
      setNotice(
        r.installed[0]
          ? `Updated ${item.title} to ${r.installed[0].versionNumber}.`
          : `${item.title} is up to date.`
      )
      loadInstalled()
    })

  const remove = (item: InstalledContent) => {
    const warning = item.neededBy.length
      ? `${item.title} is needed by ${item.neededBy.join(', ')}. Remove anyway?`
      : `Remove ${item.title}?`
    if (!window.confirm(warning)) return
    void act(item.fileName, async () => {
      await api.contentRemove(server.id, item.fileName)
      setNotice(`Removed ${item.title}.`)
      setHits((prev) =>
        prev.map((h) => (h.projectId === item.projectId ? { ...h, installed: false } : h))
      )
      loadInstalled()
    })
  }

  return (
    <div className="space-y-4 pb-6">
      {restartNeeded && server.status === 'running' && (
        <p className="rounded-md border border-amber-800 bg-amber-950/60 px-3 py-2 text-sm text-amber-200">
          Restart the server to apply changes.
        </p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      <Card title={`Installed ${noun}`}>
        {!installed ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (
          <>
            {installed.offline && (
              <div className="flex items-center gap-3 text-sm text-zinc-400">
                Can&apos;t reach Modrinth — showing local files only.
                <Button variant="ghost" onClick={loadInstalled}>
                  Retry
                </Button>
              </div>
            )}
            {locked && (
              <p className="text-xs text-zinc-500">Stop the server to update or remove {noun}.</p>
            )}
            {installed.items.length === 0 ? (
              <p className="text-sm text-zinc-500">No {noun} installed yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {installed.items.map((item) => (
                  <li
                    key={item.fileName}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.title}</div>
                      <div className="truncate text-xs text-zinc-500">
                        {item.versionNumber ?? item.fileName} ·{' '}
                        {item.source === 'modrinth' ? 'from Modrinth' : 'added manually'}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {item.update && (
                        <Button
                          disabled={locked || busy !== null}
                          onClick={() => void update(item)}
                          title={`Update to ${item.update.versionNumber}`}
                        >
                          Update
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        disabled={locked || busy !== null}
                        onClick={() => remove(item)}
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      <Card title={`Browse ${noun} on Modrinth`}>
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
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            Can&apos;t reach Modrinth.
            <Button variant="ghost" onClick={() => void runSearch(query.trim(), 0)}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {!searching && hits.length === 0 && (
              <p className="text-sm text-zinc-500">No {noun} found for this server.</p>
            )}
            <ul className="divide-y divide-zinc-800">
              {hits.map((hit) => (
                <li key={hit.projectId} className="flex items-center gap-3 py-2 text-sm">
                  {hit.iconUrl ? (
                    <img src={hit.iconUrl} alt="" className="h-10 w-10 shrink-0 rounded" />
                  ) : (
                    <div aria-hidden="true" className="h-10 w-10 shrink-0 rounded bg-zinc-800" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{hit.title}</div>
                    <div className="truncate text-xs text-zinc-500">{hit.description}</div>
                  </div>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {formatDownloads(hit.downloads)} downloads
                  </span>
                  {hit.installed ? (
                    <span className="shrink-0 text-xs text-emerald-400">Installed</span>
                  ) : (
                    <Button
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
            {searching && <p className="text-sm text-zinc-500">Searching…</p>}
            {!searching && hits.length < total && (
              <Button variant="ghost" onClick={() => void runSearch(query.trim(), hits.length)}>
                Load more
              </Button>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

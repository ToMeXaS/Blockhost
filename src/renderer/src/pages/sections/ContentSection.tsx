import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CONTENT_LABELS,
  CONTENT_SOURCE_LABELS,
  type ContentSearchHit,
  type InstalledContent,
  type InstalledContentList,
  type ServerView
} from '../../../../shared/types'
import {
  Badge,
  Button,
  Card,
  ErrorText,
  inputClass,
  Notice,
  Table,
  Td,
  Th,
  trClass
} from '../../components/ui'
import { useToast } from '../../components/Toaster'
import { api, errorMessage } from '../../lib/api'

const SEARCH_DEBOUNCE_MS = 300

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export function ContentSection({ server }: { server: ServerView }) {
  const label = CONTENT_LABELS[server.type] ?? 'Mods'
  const noun = label === 'Plugins' ? 'plugins' : 'mods'
  const locked =
    server.status === 'starting' || server.status === 'running' || server.status === 'stopping'

  const toast = useToast()
  const [installed, setInstalled] = useState<InstalledContentList | null>(null)
  const [installedError, setInstalledError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ContentSearchHit[]>([])
  const [total, setTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const searchSeq = useRef(0)
  // The query behind the results on screen, so "Load more" never mixes in a pending one.
  const shownQuery = useRef('')

  const loadInstalled = useCallback(async (): Promise<InstalledContentList | null> => {
    try {
      const list = await api.contentInstalled(server.id)
      setInstalled(list)
      setInstalledError(null)
      return list
    } catch (err) {
      setInstalledError(errorMessage(err))
      return null
    }
  }, [server.id])
  useEffect(() => {
    void loadInstalled()
  }, [loadInstalled])

  useEffect(() => {
    if (server.status !== 'running') setRestartNeeded(false)
  }, [server.status])

  const runSearch = useCallback(
    async (q: string, offset: number) => {
      const seq = ++searchSeq.current
      setSearching(true)
      setSearchError(null)
      try {
        const r = await api.contentSearch(server.id, q, offset)
        if (seq !== searchSeq.current) return
        if (offset === 0) shownQuery.current = q
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
      const r = await api.contentInstall(server.id, hit.projectId)
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
      void loadInstalled()
    })

  const update = (item: InstalledContent) =>
    act(item.fileName, async () => {
      const r = await api.contentUpdate(server.id, item.fileName)
      if (r.installed[0]) {
        toast.success(`Updated ${item.title} to ${r.installed[0].versionNumber}.`)
      } else {
        toast.info(`${item.title} is up to date.`)
      }
      void loadInstalled()
    })

  const remove = (item: InstalledContent) => {
    const warning = item.neededBy.length
      ? `${item.title} is needed by ${item.neededBy.join(', ')}. Remove anyway?`
      : `Remove ${item.title}?`
    if (!window.confirm(warning)) return
    void act(item.fileName, async () => {
      await api.contentRemove(server.id, item.fileName)
      toast.success(`Removed ${item.title}.`)
      const list = await loadInstalled()
      // Another jar from the same project (e.g. a second copy) may still be installed.
      if (list && !list.items.some((i) => i.projectId === item.projectId)) {
        setHits((prev) =>
          prev.map((h) => (h.projectId === item.projectId ? { ...h, installed: false } : h))
        )
      }
    })
  }

  return (
    <div className="space-y-4">
      {restartNeeded && server.status === 'running' && (
        <Notice tone="warn">Restart the server to apply changes.</Notice>
      )}

      <Card title={`Installed ${noun}`}>
        <div className="space-y-3">
          {installedError && (
            <div className="flex items-center gap-3 text-sm text-muted">
              <ErrorText>{installedError}</ErrorText>
              <Button size="sm" variant="ghost" onClick={() => void loadInstalled()}>
                Retry
              </Button>
            </div>
          )}
          {!installed ? (
            !installedError && <p className="text-sm text-faint">Loading…</p>
          ) : (
            <>
              {installed.offline.length > 0 && (
                <Notice tone="warn">
                  <div className="flex items-center gap-3">
                    Can&apos;t reach{' '}
                    {installed.offline.map((s) => CONTENT_SOURCE_LABELS[s]).join(', ')} — some
                    details are missing.
                    <Button size="sm" onClick={() => void loadInstalled()}>
                      Retry
                    </Button>
                  </div>
                </Notice>
              )}
              {locked && (
                <p className="text-xs text-faint">Stop the server to update or remove {noun}.</p>
              )}
              {installed.items.length === 0 ? (
                <p className="text-sm text-faint">No {noun} installed yet.</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Version</Th>
                      <Th>Source</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {installed.items.map((item) => (
                      <tr key={item.fileName} className={trClass}>
                        <Td className="font-medium text-text">{item.title}</Td>
                        <Td>
                          <span className="inline-flex items-center gap-2 font-mono">
                            {item.versionNumber ?? item.fileName}
                            {item.update && (
                              <Badge tone="warn" mono>
                                → {item.update.versionNumber}
                              </Badge>
                            )}
                          </span>
                        </Td>
                        <Td>
                          {item.source === 'modrinth' ? (
                            <Badge tone="accent">from Modrinth</Badge>
                          ) : (
                            <Badge>added manually</Badge>
                          )}
                        </Td>
                        <Td>
                          <div className="flex shrink-0 justify-end gap-2">
                            {item.update && (
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={locked || busy !== null}
                                onClick={() => void update(item)}
                                title={`Update to ${item.update.versionNumber}`}
                              >
                                Update
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={locked || busy !== null}
                              onClick={() => remove(item)}
                            >
                              Remove
                            </Button>
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </>
          )}
        </div>
      </Card>

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
              <Button size="sm" variant="ghost" onClick={() => void runSearch(query.trim(), 0)}>
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
              {!searching && hits.length < total && (
                <Button
                  className="w-full"
                  onClick={() => void runSearch(shownQuery.current, hits.length)}
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

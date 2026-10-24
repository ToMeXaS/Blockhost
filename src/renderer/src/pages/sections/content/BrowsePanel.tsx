import { Fragment, useMemo, useState } from 'react'
import {
  CONTENT_CATEGORIES,
  CONTENT_CATEGORY_LABELS,
  type ContentCategory,
  type ContentSearchHit,
  type ContentSort,
  type ContentSource,
  type ServerView
} from '../../../../../shared/types'
import { Badge, Button, Card, ErrorText, inputClass } from '../../../components/ui'
import { useToast } from '../../../components/Toaster'
import { api, errorMessage } from '../../../lib/api'
import { SourceBadge } from './SourceBadge'
import { useContentSearch } from './useContentSearch'

const SORT_LABELS: Record<ContentSort, string> = {
  relevance: 'Best match',
  downloads: 'Most downloads',
  updated: 'Recently updated',
  newest: 'Newest'
}

export function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

interface Props {
  server: ServerView
  noun: string
  available: { source: ContentSource; label: string }[]
  onOpen: (hit: ContentSearchHit) => void
  onInstalled: (restartNeeded: boolean) => void
}

export function BrowsePanel({ server, noun, available, onOpen, onInstalled }: Props) {
  // Stable identity: the hook re-searches whenever this array changes.
  const sourceIds = useMemo(() => available.map((a) => a.source), [available])
  const s = useContentSearch(server.id, sourceIds)
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  async function install(hit: ContentSearchHit) {
    setBusy(`${hit.source}:${hit.projectId}`)
    try {
      const r = await api.contentInstall(server.id, {
        source: hit.source,
        projectId: hit.projectId
      })
      const [main, ...deps] = r.installed
      if (main) {
        const extra = deps.map((d) => `${d.title} (dependency)`).join(', ')
        toast.success(`Installed ${main.title}${deps.length ? ` + ${extra}` : ''}.`)
      } else toast.info(`${hit.title} is already installed.`)
      s.markInstalled(hit)
      onInstalled(r.restartNeeded)
    } catch (err) {
      const e = err as { code?: string; details?: { externalUrl?: string } }
      if (e.code === 'CONTENT_EXTERNAL_ONLY' && e.details?.externalUrl) {
        toast.info(`${hit.title} must be downloaded from its own page.`)
        void api.openExternal(e.details.externalUrl)
      } else toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const status = (src: ContentSource) => s.statuses.find((x) => x.source === src)

  return (
    <Card title={`Browse ${noun}`}>
      <div className="space-y-3">
        {available.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Sources">
            {available.map(({ source, label }) => {
              const on = s.sources.includes(source)
              const st = status(source)
              return (
                <Fragment key={source}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => s.toggleSource(source)}
                    className={`rounded-btn border px-3 py-1 text-[13px] ${on ? 'border-accent bg-panel-2 text-text' : 'border-border text-muted'}`}
                    title={st?.message}
                  >
                    {label}
                    {on && st?.status === 'ok' && (
                      <span className="ml-1.5 font-mono text-xs text-faint">{st.total}</span>
                    )}
                    {on && st?.status === 'error' && (
                      <span className="ml-1.5 text-xs text-danger">unavailable</span>
                    )}
                    {on && st?.status === 'skipped' && (
                      <span className="ml-1.5 text-xs text-faint">no matching category</span>
                    )}
                  </button>
                  {on && st?.status === 'error' && (
                    <Button size="sm" variant="ghost" title={st.message} onClick={s.retry}>
                      Retry {label}
                    </Button>
                  )}
                </Fragment>
              )
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            className={`${inputClass} min-w-[220px] flex-1`}
            placeholder={`Search ${noun} for ${server.mcVersion}`}
            value={s.text}
            onChange={(e) => s.setText(e.target.value)}
            aria-label={`Search ${noun}`}
          />
          <select
            className={`${inputClass} w-auto`}
            aria-label="Category"
            value={s.category ?? ''}
            onChange={(e) => s.setCategory((e.target.value || null) as ContentCategory | null)}
          >
            <option value="">All categories</option>
            {CONTENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CONTENT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <select
            className={`${inputClass} w-auto`}
            aria-label="Sort"
            value={s.sort}
            onChange={(e) => s.setSort(e.target.value as ContentSort)}
          >
            {(Object.keys(SORT_LABELS) as ContentSort[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        {s.error ? (
          <div className="flex items-center gap-3 text-sm text-muted">
            <ErrorText>{s.error}</ErrorText>
            <Button size="sm" variant="ghost" onClick={s.retry}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {!s.sources.length && <p className="text-sm text-faint">Pick at least one source.</p>}
            {!s.loading && s.sources.length > 0 && s.hits.length === 0 && (
              <p className="text-sm text-faint">No {noun} found for this server.</p>
            )}
            <ul className="divide-y divide-border-soft">
              {s.hits.map((hit) => {
                const key = `${hit.source}:${hit.projectId}`
                return (
                  <li key={key} className="flex items-center gap-3 py-2">
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
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onOpen(hit)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-text hover:underline">
                          {hit.title}
                        </span>
                        {hit.author && (
                          <span className="truncate text-xs text-faint">by {hit.author}</span>
                        )}
                      </div>
                      <div className="line-clamp-2 text-[13px] text-muted">{hit.description}</div>
                    </button>
                    {hit.untestedOnVersion && (
                      <Badge tone="warn">not tested on {server.mcVersion}</Badge>
                    )}
                    <SourceBadge source={hit.source} />
                    <span className="shrink-0 font-mono text-xs text-faint">
                      {formatDownloads(hit.downloads)}
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
                        {busy === key ? 'Installing…' : 'Install'}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
            {s.loading && <p className="text-sm text-faint">Searching…</p>}
            {s.pageError && (
              <div className="flex items-center gap-3 text-sm text-muted">
                <ErrorText>{s.pageError}</ErrorText>
                <Button size="sm" variant="ghost" onClick={s.retryPage}>
                  Retry
                </Button>
              </div>
            )}
            {!s.loading && !s.pageError && s.canLoadMore && (
              <Button className="w-full" onClick={s.loadMore}>
                Load more
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

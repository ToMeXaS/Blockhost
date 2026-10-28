import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CONTENT_SOURCE_LABELS,
  type ContentSource,
  type InstalledContent,
  type InstalledContentList,
  type ServerView
} from '../../../../../shared/types'
import {
  Badge,
  Button,
  Card,
  ErrorText,
  inputClass,
  Menu,
  Notice,
  Segmented,
  Switch
} from '../../../components/ui'
import { useToast } from '../../../components/Toaster'
import { api, errorMessage } from '../../../lib/api'
import {
  countFor,
  filterInstalled,
  type InstalledFilter,
  type InstalledSort
} from '../../../lib/contentFilters'
import { SourceBadge } from './SourceBadge'

interface Props {
  server: ServerView
  noun: string
  refreshKey: number
  onOpenProject: (ref: { source: ContentSource; projectId: string }) => void
  onCounts?: (counts: { total: number; updates: number }) => void
  /** Switches to the browse tab; offered when nothing is installed. */
  onBrowse?: () => void
}

export function InstalledList({
  server,
  noun,
  refreshKey,
  onOpenProject,
  onCounts,
  onBrowse
}: Props) {
  const locked =
    server.status === 'starting' || server.status === 'running' || server.status === 'stopping'
  const toast = useToast()
  const [list, setList] = useState<InstalledContentList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState<InstalledFilter>('all')
  const [sort, setSort] = useState<InstalledSort>('name')
  const [text, setText] = useState('')

  const load = useCallback(async () => {
    try {
      setList(await api.contentInstalled(server.id))
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [server.id])
  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const items = list?.items ?? []
  const shown = useMemo(
    () => filterInstalled(items, { filter, sort, text }),
    [items, filter, sort, text]
  )
  const updates = countFor(items, 'updates')
  useEffect(() => {
    if (list) onCounts?.({ total: list.items.length, updates })
  }, [list, updates, onCounts])

  async function act(key: string, action: () => Promise<void>) {
    setBusy(key)
    try {
      await action()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
      void load()
    }
  }

  const toggle = (item: InstalledContent, enabled: boolean) => {
    if (
      !enabled &&
      item.neededBy.length &&
      !window.confirm(`${item.title} is needed by ${item.neededBy.join(', ')}. Disable anyway?`)
    )
      return
    void act(item.fileName, () => api.contentSetEnabled(server.id, item.fileName, enabled))
  }

  const update = (item: InstalledContent) =>
    act(item.fileName, async () => {
      const r = await api.contentUpdate(server.id, item.fileName)
      if (r.installed[0]) toast.success(`Updated ${item.title} to ${r.installed[0].versionNumber}.`)
      else toast.info(`${item.title} is up to date.`)
    })

  const updateAll = () =>
    act('*', async () => {
      const r = await api.contentUpdateAll(server.id)
      const parts = [`Updated ${r.updated.length}`]
      if (r.failed.length)
        parts.push(
          `${r.failed.length} failed: ${r.failed.map((f) => `${f.title} (${f.message})`).join('; ')}`
        )
      ;(r.failed.length ? toast.error : toast.success)(parts.join(' · '))
    })

  const remove = (item: InstalledContent) =>
    act(item.fileName, async () => {
      const orphans = await api.contentOrphans(server.id, item.fileName)
      const lead = item.neededBy.length
        ? `${item.title} is needed by ${item.neededBy.join(', ')}. Remove anyway?`
        : `Remove ${item.title}?`
      if (!window.confirm(lead)) return
      const removeOrphans =
        orphans.length > 0 &&
        window.confirm(
          `Also remove ${orphans.length} ${orphans.length === 1 ? 'dependency' : 'dependencies'} no longer needed (${orphans.map((o) => o.title).join(', ')})?`
        )
      await api.contentRemove(server.id, item.fileName, removeOrphans)
      toast.success(`Removed ${item.title}${removeOrphans ? ` and ${orphans.length} more` : ''}.`)
    })

  const setBeta = (value: boolean) => act('beta', () => api.contentSetIncludeBeta(server.id, value))

  return (
    <Card>
      <div className="space-y-3">
        {error && (
          <div className="flex items-center gap-3 text-sm text-muted">
            <ErrorText>{error}</ErrorText>
            <Button size="sm" variant="ghost" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}
        {list && list.offline.length > 0 && (
          <Notice tone="warn">
            <div className="flex items-center gap-3">
              Couldn&apos;t check {list.offline.map((s) => CONTENT_SOURCE_LABELS[s]).join(', ')} for
              updates.
              <Button size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          </Notice>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            className={`${inputClass} max-w-[240px]`}
            placeholder={`Filter ${noun}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={`Filter ${noun}`}
          />
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All (${countFor(items, 'all')})` },
              { value: 'updates', label: `Updates (${updates})` },
              { value: 'disabled', label: `Disabled (${countFor(items, 'disabled')})` },
              { value: 'manual', label: `Manual (${countFor(items, 'manual')})` }
            ]}
          />
          <Segmented
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'name', label: 'Name' },
              { value: 'recent', label: 'Recent' }
            ]}
          />
          <label className="ml-auto flex items-center gap-2 text-[13px] text-muted">
            Include beta versions
            <Switch
              label="Include beta versions"
              checked={list?.includeBeta ?? false}
              disabled={busy !== null}
              onChange={setBeta}
            />
          </label>
          {updates > 0 && (
            <Button
              size="sm"
              variant="primary"
              disabled={locked || busy !== null}
              onClick={() => void updateAll()}
            >
              {busy === '*' ? 'Updating…' : `Update all (${updates})`}
            </Button>
          )}
        </div>
        {locked && <p className="text-xs text-faint">Stop the server to change {noun}.</p>}
        {!list ? (
          !error && <p className="text-sm text-faint">Loading…</p>
        ) : shown.length === 0 ? (
          items.length ? (
            <p className="text-sm text-faint">No {noun} match.</p>
          ) : (
            <div className="flex flex-col items-center gap-3 py-8 text-sm text-faint">
              No {noun} installed yet.
              {onBrowse && (
                <Button variant="primary" onClick={onBrowse}>
                  Browse {noun}
                </Button>
              )}
            </div>
          )
        ) : (
          <ul className="divide-y divide-border-soft">
            {shown.map((item) => (
              <li
                key={item.fileName}
                className={`flex items-center gap-3 py-2 ${item.disabled ? 'opacity-60' : ''}`}
              >
                {item.iconUrl ? (
                  <img
                    src={item.iconUrl}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-btn bg-panel-2"
                  />
                ) : (
                  <div aria-hidden="true" className="h-9 w-9 shrink-0 rounded-btn bg-panel-2" />
                )}
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left disabled:cursor-default"
                  disabled={item.source === 'manual' || !item.projectId}
                  onClick={() =>
                    item.source !== 'manual' &&
                    item.projectId &&
                    onOpenProject({ source: item.source, projectId: item.projectId })
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-text">{item.title}</span>
                    {item.isDependency && <Badge>dependency</Badge>}
                    {item.disabled && <Badge tone="warn">disabled</Badge>}
                  </div>
                  <div className="flex items-center gap-2 font-mono text-xs text-faint">
                    {item.versionNumber ?? item.fileName}
                    {item.update && (
                      <Badge tone="warn" mono>
                        → {item.update.versionNumber}
                      </Badge>
                    )}
                  </div>
                </button>
                <SourceBadge source={item.source} />
                {item.update && (
                  <Button
                    size="sm"
                    disabled={locked || busy !== null}
                    title={locked ? `Stop the server to update ${noun}` : undefined}
                    onClick={() => void update(item)}
                  >
                    {busy === item.fileName ? 'Updating…' : 'Update'}
                  </Button>
                )}
                <Switch
                  label={`${item.disabled ? 'Enable' : 'Disable'} ${item.title}`}
                  checked={!item.disabled}
                  disabled={locked || busy !== null}
                  onChange={(on) => toggle(item, on)}
                />
                <Menu
                  label={`Actions for ${item.title}`}
                  align="right"
                  button={<span className="px-2 text-muted">⋯</span>}
                  items={[
                    ...(item.update
                      ? [
                          {
                            label: `Update to ${item.update.versionNumber}`,
                            onSelect: () => void update(item),
                            disabled: locked || busy !== null
                          }
                        ]
                      : []),
                    ...(item.source !== 'manual' && item.projectId
                      ? [
                          {
                            label: 'Open page',
                            onSelect: () =>
                              onOpenProject({
                                source: item.source as ContentSource,
                                projectId: item.projectId!
                              })
                          }
                        ]
                      : []),
                    {
                      label: 'Remove',
                      danger: true,
                      onSelect: () => void remove(item),
                      disabled: locked || busy !== null
                    }
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

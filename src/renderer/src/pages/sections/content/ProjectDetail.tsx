import { useEffect, useMemo, useState } from 'react'
import type {
  ContentPlanView,
  ContentProjectView,
  ContentRef,
  ContentSearchHit,
  ContentVersionView,
  ServerView
} from '../../../../../shared/types'
import { Badge, Button, Card, ErrorText, Switch } from '../../../components/ui'
import { useToast } from '../../../components/Toaster'
import { api, errorMessage } from '../../../lib/api'
import { renderDescription } from '../../../lib/sanitize'
import { formatDownloads } from './BrowsePanel'
import { SourceBadge } from './SourceBadge'

const LINK_LABELS = {
  page: 'Project page',
  issues: 'Issues',
  source: 'Source code',
  wiki: 'Wiki',
  discord: 'Discord',
  other: 'Link'
} as const

interface Props {
  server: ServerView
  projectRef: ContentRef
  fallback?: ContentSearchHit
  onBack: () => void
  onChanged: (restartNeeded: boolean, ref: ContentRef) => void
}

export function ProjectDetail({ server, projectRef, fallback, onBack, onChanged }: Props) {
  const toast = useToast()
  const [project, setProject] = useState<ContentProjectView | null>(null)
  const [versions, setVersions] = useState<ContentVersionView[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [plan, setPlan] = useState<ContentPlanView | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [reloadVersions, setReloadVersions] = useState(0)

  useEffect(() => {
    let live = true
    setError(null)
    api.contentProject(server.id, projectRef).then(
      (p) => live && setProject(p),
      (e) => live && setError(errorMessage(e))
    )
    return () => {
      live = false
    }
  }, [server.id, projectRef, reload])

  useEffect(() => {
    let live = true
    setVersions(null)
    setVersionsError(null)
    api.contentVersions(server.id, projectRef, showAll).then(
      (v) => live && setVersions(v),
      (e) => live && setVersionsError(errorMessage(e))
    )
    return () => {
      live = false
    }
  }, [server.id, projectRef, showAll, reloadVersions])

  useEffect(() => {
    if (!project || project.installed) return
    let live = true
    setPlan(null)
    setPlanError(null)
    api.contentPlan(server.id, projectRef).then(
      (p) => live && setPlan(p),
      (e) => live && setPlanError(errorMessage(e))
    )
    return () => {
      live = false
    }
  }, [server.id, projectRef, project])

  const html = useMemo(() => (project ? renderDescription(project.description) : ''), [project])
  const latestCompatible = versions?.find((v) => v.compatible && v.downloadable)
  const externalOnly =
    versions !== null && !latestCompatible && versions.find((v) => v.compatible && v.externalUrl)

  async function install(versionId?: string) {
    setBusy(true)
    try {
      const r = await api.contentInstall(server.id, projectRef, versionId)
      const [main, ...deps] = r.installed
      if (main)
        toast.success(
          `Installed ${main.title} ${main.versionNumber}${deps.length ? ` + ${deps.map((d) => d.title).join(', ')}` : ''}.`
        )
      onChanged(r.restartNeeded, projectRef)
      setReload((n) => n + 1)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const title = project?.title ?? fallback?.title ?? 'Loading…'
  const icon = project?.iconUrl ?? fallback?.iconUrl ?? null

  const installAction = project?.installed ? (
    <Badge tone="accent" mono>
      Installed · {project.installed.versionNumber}
    </Badge>
  ) : externalOnly ? (
    <Button
      variant="primary"
      onClick={() =>
        api.openExternal(externalOnly.externalUrl!).catch((err) => toast.error(errorMessage(err)))
      }
    >
      Open in browser
    </Button>
  ) : (
    <Button
      variant="primary"
      disabled={busy || !latestCompatible || Boolean(planError)}
      onClick={() => void install()}
    >
      {busy
        ? 'Installing…'
        : latestCompatible
          ? `Install ${latestCompatible.versionNumber}`
          : 'Install'}
    </Button>
  )

  return (
    <div className="space-y-4">
      <button type="button" className="text-sm text-muted hover:text-text" onClick={onBack}>
        ← Back to results
      </button>
      <Card>
        <div className="space-y-3">
          {error && (
            <div className="flex items-center gap-3 text-sm">
              <ErrorText>{error}</ErrorText>
              <Button size="sm" variant="ghost" onClick={() => setReload((n) => n + 1)}>
                Retry
              </Button>
            </div>
          )}
          <div className="flex items-start gap-4">
            {icon ? (
              <img src={icon} alt="" className="h-20 w-20 shrink-0 rounded-btn bg-panel-2" />
            ) : (
              <div aria-hidden="true" className="h-20 w-20 shrink-0 rounded-btn bg-panel-2" />
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-xl font-semibold text-text">{title}</h2>
                {(project?.author ?? fallback?.author) && (
                  <span className="text-sm text-muted">
                    by {project?.author ?? fallback?.author}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted">{project?.summary ?? fallback?.description}</p>
              <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-faint">
                <SourceBadge source={projectRef.source} />
                {project && <span>{formatDownloads(project.downloads)} downloads</span>}
                {project?.updatedAt && (
                  <span>updated {new Date(project.updatedAt).toLocaleDateString()}</span>
                )}
                {project?.license && <span>{project.license}</span>}
              </div>
              {project && project.links.length > 0 && (
                <div className="flex flex-wrap gap-3 pt-1 text-sm">
                  {project.links.map((l) => (
                    <a
                      key={l.url}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      {LINK_LABELS[l.kind]}
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="shrink-0">{installAction}</div>
          </div>
        </div>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Description">
          <div className="space-y-4">
            {project && project.gallery.length > 0 && (
              <div className="flex gap-2 overflow-x-auto">
                {project.gallery.map((g) => (
                  <button
                    key={g.url}
                    type="button"
                    onClick={() => setLightbox(g.url)}
                    className="shrink-0"
                  >
                    <img
                      src={g.url}
                      alt={g.title ?? ''}
                      className="h-24 rounded-btn object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
            {project ? (
              /* Sanitized by renderDescription (DOMPurify); links open via the window-open handler. */
              <div
                className="prose-sm max-w-none text-sm leading-relaxed text-muted [&_a]:text-accent [&_h1]:text-lg [&_h1]:text-text [&_h2]:text-base [&_h2]:text-text [&_img]:max-w-full"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              !error && <p className="text-sm text-faint">Loading…</p>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          {!project?.installed && (plan || planError) && (
            <Card title="Dependencies">
              <div className="space-y-1 text-sm">
                {planError ? (
                  <ErrorText>{planError}</ErrorText>
                ) : (
                  plan && (
                    <>
                      {plan.install.length > 1 && (
                        <p>
                          Will also install:{' '}
                          {plan.install
                            .slice(1)
                            .map((i) => i.title)
                            .join(', ')}
                        </p>
                      )}
                      {plan.manual.map((m) => (
                        <p key={m.title} className="text-warn">
                          Needs {m.title} — install it yourself
                          {m.externalUrl && (
                            <>
                              {' '}
                              (
                              <a
                                href={m.externalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                              >
                                link
                              </a>
                              )
                            </>
                          )}
                        </p>
                      ))}
                      {plan.optional.length > 0 && (
                        <p className="text-faint">Optional: {plan.optional.join(', ')}</p>
                      )}
                      {plan.install.length <= 1 && !plan.manual.length && !plan.optional.length && (
                        <p className="text-faint">No dependencies.</p>
                      )}
                    </>
                  )
                )}
              </div>
            </Card>
          )}

          <Card
            title="Versions"
            actions={
              <label className="flex items-center gap-2 text-xs text-muted">
                Incompatible
                <Switch
                  label="Show incompatible versions"
                  checked={showAll}
                  onChange={setShowAll}
                />
              </label>
            }
          >
            {versionsError ? (
              <div className="flex items-center gap-3 text-sm">
                <ErrorText>{versionsError}</ErrorText>
                <Button size="sm" variant="ghost" onClick={() => setReloadVersions((n) => n + 1)}>
                  Retry
                </Button>
              </div>
            ) : versions === null ? (
              <p className="text-sm text-faint">Loading…</p>
            ) : versions.length === 0 ? (
              <p className="text-sm text-faint">No versions for {server.mcVersion}.</p>
            ) : (
              <ul className="max-h-[480px] divide-y divide-border-soft overflow-y-auto">
                {versions.map((v) => (
                  <li
                    key={v.id}
                    className={`flex items-center gap-2 py-2 ${v.compatible ? '' : 'opacity-50'}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-sm text-text">
                          {v.versionNumber}
                        </span>
                        {v.channel !== 'release' && <Badge tone="warn">{v.channel}</Badge>}
                      </div>
                      <div className="truncate text-xs text-faint">
                        {[
                          v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : null,
                          v.mcVersions.slice(-3).join(', ') || null
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    {v.compatible && v.downloadable && !project?.installed && (
                      <Button size="sm" disabled={busy} onClick={() => void install(v.id)}>
                        Install
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {lightbox && (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
          onClick={() => setLightbox(null)}
          aria-label="Close image"
        >
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-btn" />
        </button>
      )}
    </div>
  )
}

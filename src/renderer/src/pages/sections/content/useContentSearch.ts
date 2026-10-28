import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ContentCategory,
  ContentCursor,
  ContentRef,
  ContentSearchHit,
  ContentSort,
  ContentSource,
  ContentSourceStatus
} from '../../../../../shared/types'
import { api, errorMessage } from '../../../lib/api'
import { loadPrefs, savePrefs } from '../../../lib/browsePrefs'

const DEBOUNCE_MS = 300

export function useContentSearch(serverId: string, available: ContentSource[]) {
  const initial = useMemo(() => loadPrefs(serverId), [serverId])
  const [text, setText] = useState('')
  const [chosen, setChosen] = useState<ContentSource[] | null>(initial.sources)
  const [category, setCategory] = useState<ContentCategory | null>(initial.category)
  const [sort, setSort] = useState<ContentSort>(initial.sort)
  const [hits, setHits] = useState<ContentSearchHit[]>([])
  const [statuses, setStatuses] = useState<ContentSourceStatus[]>([])
  const [cursor, setCursor] = useState<ContentCursor | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A failed "load more" keeps the hits on screen and reports here instead.
  const [pageError, setPageError] = useState<string | null>(null)
  const seq = useRef(0)

  const sources = useMemo(
    () => (chosen ?? available).filter((s) => available.includes(s)),
    [chosen, available]
  )

  useEffect(
    () => savePrefs(serverId, { sources: chosen, category, sort }),
    [serverId, chosen, category, sort]
  )

  const run = useCallback(
    async (from: ContentCursor | null) => {
      const n = ++seq.current
      setLoading(true)
      setError(null)
      setPageError(null)
      try {
        const r = await api.contentSearch(serverId, {
          text: text.trim(),
          sources,
          category,
          sort,
          cursor: from
        })
        if (n !== seq.current) return
        setHits((prev) => (from ? [...prev, ...r.hits] : r.hits))
        // Keep first-page totals; later pages only update error/ok state.
        setStatuses((prev) =>
          from
            ? r.sources.map((s) => ({
                ...s,
                total: prev.find((p) => p.source === s.source)?.total ?? s.total
              }))
            : r.sources
        )
        setCursor(r.cursor)
      } catch (err) {
        if (n !== seq.current) return
        if (from === null) setError(errorMessage(err))
        else setPageError(errorMessage(err))
      } finally {
        if (n === seq.current) setLoading(false)
      }
    },
    [serverId, text, sources, category, sort]
  )

  useEffect(() => {
    if (!sources.length) {
      seq.current++
      setHits([])
      setStatuses([])
      setCursor(null)
      setError(null)
      setPageError(null)
      setLoading(false)
      return
    }
    const timer = setTimeout(() => void run(null), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [run, sources.length])

  const toggleSource = (s: ContentSource): void =>
    setChosen((prev) => {
      const cur = prev ?? available
      return cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]
    })

  const markInstalled = (ref: ContentRef): void =>
    setHits((prev) =>
      prev.map((h) =>
        h.source === ref.source && h.projectId === ref.projectId ? { ...h, installed: true } : h
      )
    )

  return {
    text,
    setText,
    sources,
    toggleSource,
    category,
    setCategory,
    sort,
    setSort,
    hits,
    statuses,
    loading,
    error,
    pageError,
    canLoadMore: cursor !== null,
    loadMore: () => void run(cursor),
    retryPage: () => void run(cursor),
    retry: () => void run(null),
    markInstalled
  }
}

import { useCallback, useEffect, useState } from 'react'
import type { ConfigFileInfo, ServerView } from '../../../../shared/types'
import { useToast } from '../../components/Toaster'
import { api, errorMessage } from '../../lib/api'
import { PropertiesEditor } from './config/PropertiesEditor'

const PROPERTIES = 'server.properties'

export function PropertiesSection({
  server,
  onChanged
}: {
  server: ServerView
  onChanged: () => void
}) {
  const toast = useToast()
  const [files, setFiles] = useState<ConfigFileInfo[]>([])
  const [active, setActive] = useState<string>(PROPERTIES)
  const [, setOpened] = useState<Set<string>>(() => new Set([PROPERTIES]))
  const [dirty, setDirty] = useState<Record<string, number>>({})

  useEffect(() => {
    api
      .listConfigFiles(server.id)
      .then(setFiles)
      .catch((err) => toast.error(errorMessage(err)))
    // toast is stable for the provider's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id])

  const markDirty = useCallback(
    (key: string, count: number) =>
      setDirty((prev) => (prev[key] === count ? prev : { ...prev, [key]: count })),
    []
  )
  const onPropertiesDirty = useCallback((n: number) => markDirty(PROPERTIES, n), [markDirty])

  function open(key: string) {
    setActive(key)
    setOpened((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  }

  const chips = [
    { key: PROPERTIES, label: PROPERTIES },
    ...files.map((f) => ({ key: f.id, label: f.label }))
  ]

  return (
    <div className="space-y-4 pb-6">
      <div role="tablist" aria-label="Config files" className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            role="tab"
            aria-selected={chip.key === active}
            onClick={() => open(chip.key)}
            className={`inline-flex items-center gap-1.5 rounded-btn border px-3 py-1 font-mono text-xs transition-colors ${
              chip.key === active
                ? 'border-accent bg-nav-active text-text'
                : 'border-border text-muted hover:text-text'
            }`}
          >
            {chip.label}
            {(dirty[chip.key] ?? 0) > 0 && (
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="unsaved changes" />
            )}
          </button>
        ))}
      </div>

      <div hidden={active !== PROPERTIES}>
        <PropertiesEditor server={server} onChanged={onChanged} onDirtyChange={onPropertiesDirty} />
      </div>
      {/* YAML editors are added in Task 7 */}
    </div>
  )
}

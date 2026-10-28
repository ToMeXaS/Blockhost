import { useEffect, useMemo, useState } from 'react'
import type { PropertyEntry, ServerView } from '../../../../../shared/types'
import { Button, Card, ErrorText, inputClass, Notice, Switch } from '../../../components/ui'
import { useToast } from '../../../components/Toaster'
import { api, errorMessage } from '../../../lib/api'
import {
  countChanges,
  groupProperties,
  type PropertyDef,
  type PropertyRowModel
} from '../../../lib/propertyCatalog'
import { ConfigRail, scrollToSection, useScrollSpy } from './ConfigRail'
import { ConfigSaveBar, useSavedToast } from './ConfigSaveBar'

const KEY_PATTERN = /^[^\s=:#!\\]+$/
const anchor = (id: string): string => `cfg-properties-${id}`

export function PropertiesEditor({
  server,
  onChanged,
  onDirtyChange
}: {
  server: ServerView
  onChanged: () => void
  onDirtyChange: (count: number) => void
}) {
  const toast = useToast()
  const savedToast = useSavedToast(server)
  const [saved, setSaved] = useState<PropertyEntry[] | null>(null)
  const [entries, setEntries] = useState<PropertyEntry[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  useEffect(() => {
    api
      .readProperties(server.id)
      .then((list) => {
        setSaved(list)
        setEntries(list)
      })
      .catch((err) => setLoadError(errorMessage(err)))
  }, [server.id])

  const changes = saved && entries ? countChanges(saved, entries) : 0
  useEffect(() => onDirtyChange(changes), [changes, onDirtyChange])

  const groups = useMemo(() => (entries ? groupProperties(entries, query) : []), [entries, query])
  const visible = groups.filter((g) => g.rows.length > 0 || (g.id === 'other' && !query))
  const active = useScrollSpy(visible.map((g) => anchor(g.id)))

  function set(key: string, value: string) {
    setEntries((prev) => {
      const list = prev ?? []
      return list.some((e) => e.key === key)
        ? list.map((e) => (e.key === key ? { key, value } : e))
        : [...list, { key, value }]
    })
  }

  function remove(key: string) {
    setEntries((prev) => (prev ?? []).filter((e) => e.key !== key))
  }

  async function save() {
    if (!entries) return
    setSaving(true)
    try {
      await api.writeProperties(server.id, entries)
      setSaved(entries)
      savedToast()
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (!entries)
    return loadError ? (
      <ErrorText>{loadError}</ErrorText>
    ) : (
      <p className="text-sm text-faint">Loading…</p>
    )

  const newKeyValid = KEY_PATTERN.test(newKey) && !entries.some((e) => e.key === newKey)

  return (
    <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-6">
      <ConfigRail
        query={query}
        onQuery={setQuery}
        placeholder="Search settings"
        items={visible.map((g) => ({ id: anchor(g.id), label: g.label, count: g.rows.length }))}
        active={active}
        onSelect={scrollToSection}
      />
      <div className="min-w-0 space-y-4">
        {entries.length <= 2 && (
          <Notice tone="info">
            The full list of settings is generated the first time the server starts. You can already
            set the main ones below.
          </Notice>
        )}
        {visible.length === 0 && <p className="text-sm text-faint">No settings match “{query}”.</p>}
        {visible.map((group) => (
          <section key={group.id} id={anchor(group.id)} className="scroll-mt-4">
            <Card title={group.label}>
              <div className="divide-y divide-border-soft">
                {group.rows.map((row) =>
                  row.def ? (
                    <KnownRow
                      key={row.key}
                      row={row as PropertyRowModel & { def: PropertyDef }}
                      onChange={(v) => set(row.key, v)}
                    />
                  ) : (
                    <OtherRow
                      key={row.key}
                      row={row}
                      onChange={(v) => set(row.key, v)}
                      onRemove={() => remove(row.key)}
                    />
                  )
                )}
                {group.id === 'other' && !query && (
                  <div className="flex items-center gap-2 py-3">
                    <input
                      className={`${inputClass} font-mono text-xs`}
                      placeholder="new-key"
                      aria-label="New property name"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value.trim())}
                    />
                    <input
                      className={inputClass}
                      placeholder="value"
                      aria-label="New property value"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                    />
                    <Button
                      disabled={!newKeyValid}
                      onClick={() => {
                        set(newKey, newValue)
                        setNewKey('')
                        setNewValue('')
                      }}
                    >
                      Add
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          </section>
        ))}
        <ConfigSaveBar
          count={changes}
          saving={saving}
          onSave={() => void save()}
          onDiscard={() => setEntries(saved)}
        />
      </div>
    </div>
  )
}

function KnownRow({
  row,
  onChange
}: {
  row: PropertyRowModel & { def: PropertyDef }
  onChange: (value: string) => void
}) {
  const { def, value } = row
  const modified = value !== def.default
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm text-text">
          {def.label}
          {modified && (
            <span
              className="text-[11px] font-medium text-accent"
              title={`Default: ${def.default || '(blank)'}`}
            >
              Modified
            </span>
          )}
        </div>
        <div className="font-mono text-xs text-faint">{def.key}</div>
        <div className="mt-0.5 text-xs text-faint">{def.description}</div>
      </div>
      <div className="flex w-64 shrink-0 items-center justify-end gap-2">
        {modified && (
          <Button
            variant="ghost"
            aria-label={`Reset ${def.key} to default`}
            title={`Reset to ${def.default || '(blank)'}`}
            onClick={() => onChange(def.default)}
          >
            ↺
          </Button>
        )}
        <div className="w-52">
          <PropertyInput def={def} value={value} onChange={onChange} />
        </div>
      </div>
    </div>
  )
}

function PropertyInput({
  def,
  value,
  onChange
}: {
  def: PropertyDef
  value: string
  onChange: (value: string) => void
}) {
  if (def.kind === 'bool')
    return (
      <div className="flex justify-end">
        <Switch
          checked={value === 'true'}
          onChange={(v) => onChange(v ? 'true' : 'false')}
          label={def.label}
        />
      </div>
    )
  if (def.kind === 'select') {
    // Keep values the catalog doesn't know (older versions, e.g. level-type=default).
    const options = def.options?.includes(value) ? def.options : [value, ...(def.options ?? [])]
    return (
      <select
        className={`${inputClass} pr-8`}
        aria-label={def.label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  }
  if (def.kind === 'number')
    return (
      <input
        className={`${inputClass} font-mono`}
        type="number"
        aria-label={def.label}
        min={def.min}
        max={def.max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const n = Number(value)
          if (value === '' || !Number.isFinite(n)) return onChange(def.default)
          const clamped = Math.min(def.max ?? n, Math.max(def.min ?? n, Math.round(n)))
          if (String(clamped) !== value) onChange(String(clamped))
        }}
      />
    )
  return (
    <input
      className={inputClass}
      aria-label={def.label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function OtherRow({
  row,
  onChange,
  onRemove
}: {
  row: PropertyRowModel
  onChange: (value: string) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0 truncate font-mono text-xs text-text-2">{row.key}</div>
      <div className="flex w-64 shrink-0 items-center gap-2">
        <input
          className={inputClass}
          aria-label={row.key}
          value={row.value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button variant="ghost" aria-label={`Remove ${row.key}`} onClick={onRemove}>
          ✕
        </Button>
      </div>
    </div>
  )
}

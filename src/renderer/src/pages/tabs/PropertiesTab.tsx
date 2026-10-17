import { useEffect, useState } from 'react'
import type { PropertyEntry, ServerView } from '../../../../shared/types'
import { Button, ErrorText, Field, inputClass } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'

type Kind = 'text' | 'number' | 'bool' | 'select'

interface CommonProperty {
  key: string
  label: string
  kind: Kind
  options?: string[]
  hint?: string
}

const COMMON: CommonProperty[] = [
  {
    key: 'motd',
    label: 'Message of the day',
    kind: 'text',
    hint: 'Shown in the multiplayer server list.'
  },
  { key: 'max-players', label: 'Max players', kind: 'number' },
  {
    key: 'gamemode',
    label: 'Game mode',
    kind: 'select',
    options: ['survival', 'creative', 'adventure', 'spectator']
  },
  {
    key: 'difficulty',
    label: 'Difficulty',
    kind: 'select',
    options: ['peaceful', 'easy', 'normal', 'hard']
  },
  { key: 'view-distance', label: 'View distance (chunks)', kind: 'number' },
  { key: 'server-port', label: 'Port', kind: 'number' },
  { key: 'pvp', label: 'Player vs player', kind: 'bool' },
  { key: 'white-list', label: 'Whitelist (only listed players can join)', kind: 'bool' },
  {
    key: 'online-mode',
    label: 'Online mode',
    kind: 'bool',
    hint: 'Checks accounts with Mojang. Turn off only for offline LAN play, since anyone could then join with any name.'
  }
]

// Minecraft's own defaults, shown until the server writes its full server.properties on first start.
const DEFAULTS: Record<string, string> = {
  motd: 'A Minecraft Server',
  'max-players': '20',
  gamemode: 'survival',
  difficulty: 'easy',
  'view-distance': '10',
  pvp: 'true',
  'white-list': 'false',
  'online-mode': 'true'
}

const KEY_PATTERN = /^[^\s=:#!\\]+$/

export function PropertiesTab({
  server,
  onChanged
}: {
  server: ServerView
  onChanged: () => void
}) {
  const [entries, setEntries] = useState<PropertyEntry[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  useEffect(() => {
    api
      .readProperties(server.id)
      .then(setEntries)
      .catch((err) => setError(errorMessage(err)))
  }, [server.id])

  const get = (key: string): string =>
    entries?.find((e) => e.key === key)?.value ?? DEFAULTS[key] ?? ''

  function set(key: string, value: string) {
    setEntries((prev) => {
      const list = prev ?? []
      return list.some((e) => e.key === key)
        ? list.map((e) => (e.key === key ? { key, value } : e))
        : [...list, { key, value }]
    })
    setDirty(true)
    setNotice(null)
  }

  function remove(key: string) {
    setEntries((prev) => (prev ?? []).filter((e) => e.key !== key))
    setDirty(true)
    setNotice(null)
  }

  async function save() {
    if (!entries) return
    setSaving(true)
    setError(null)
    try {
      await api.writeProperties(server.id, entries)
      setDirty(false)
      const stopped = server.status === 'stopped' || server.status === 'crashed'
      setNotice(stopped ? 'Saved.' : 'Saved. Restart the server to apply the changes.')
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (!entries)
    return error ? (
      <ErrorText>{error}</ErrorText>
    ) : (
      <p className="text-sm text-zinc-500">Loading…</p>
    )

  const commonKeys = new Set(COMMON.map((c) => c.key))
  const advanced = entries.filter((e) => !commonKeys.has(e.key))
  const newKeyValid = KEY_PATTERN.test(newKey) && !entries.some((e) => e.key === newKey)

  return (
    <div className="max-w-3xl space-y-6 pb-6">
      {entries.length <= 2 && (
        <p className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-400">
          The full list of settings is generated the first time the server starts. You can already
          set the common ones below.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {COMMON.map((def) => (
          <PropertyInput
            key={def.key}
            def={def}
            value={get(def.key)}
            onChange={(v) => set(def.key, v)}
          />
        ))}
      </div>

      <details className="rounded-md border border-zinc-800 bg-zinc-900 p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Advanced: all other properties ({advanced.length})
        </summary>
        <table className="mt-3 w-full text-sm">
          <tbody>
            {advanced.map((entry) => (
              <tr key={entry.key} className="border-t border-zinc-800">
                <td className="py-1 pr-3 font-mono text-xs text-zinc-400">{entry.key}</td>
                <td className="py-1">
                  <input
                    className={inputClass}
                    value={entry.value}
                    onChange={(e) => set(entry.key, e.target.value)}
                  />
                </td>
                <td className="py-1 pl-2">
                  <Button
                    variant="ghost"
                    aria-label={`Remove ${entry.key}`}
                    onClick={() => remove(entry.key)}
                  >
                    ✕
                  </Button>
                </td>
              </tr>
            ))}
            <tr className="border-t border-zinc-800">
              <td className="py-2 pr-3">
                <input
                  className={`${inputClass} font-mono text-xs`}
                  placeholder="new-key"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value.trim())}
                />
              </td>
              <td className="py-2">
                <input
                  className={inputClass}
                  placeholder="value"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                />
              </td>
              <td className="py-2 pl-2">
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
              </td>
            </tr>
          </tbody>
        </table>
      </details>

      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        {notice && <span className="text-sm text-emerald-400">{notice}</span>}
      </div>
    </div>
  )
}

function PropertyInput({
  def,
  value,
  onChange
}: {
  def: CommonProperty
  value: string
  onChange: (value: string) => void
}) {
  if (def.kind === 'bool') {
    return (
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={value === 'true'}
          onChange={(e) => onChange(String(e.target.checked))}
        />
        <span>
          <span className="text-zinc-200">{def.label}</span>
          {def.hint && <span className="block text-xs text-zinc-500">{def.hint}</span>}
        </span>
      </label>
    )
  }
  return (
    <Field label={def.label} hint={def.hint}>
      {def.kind === 'select' ? (
        <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
          {def.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          className={inputClass}
          type={def.kind === 'number' ? 'number' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  )
}

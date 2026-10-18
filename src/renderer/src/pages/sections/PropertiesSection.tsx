import { useEffect, useState } from 'react'
import type { PropertyEntry, ServerView } from '../../../../shared/types'
import {
  Button,
  Card,
  ErrorText,
  inputClass,
  Notice,
  Switch,
  Table,
  Td,
  Th,
  trClass
} from '../../components/ui'
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

export function PropertiesSection({
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
    return error ? <ErrorText>{error}</ErrorText> : <p className="text-sm text-faint">Loading…</p>

  const commonKeys = new Set(COMMON.map((c) => c.key))
  const advanced = entries.filter((e) => !commonKeys.has(e.key))
  const newKeyValid = KEY_PATTERN.test(newKey) && !entries.some((e) => e.key === newKey)
  const restartNeeded = !!notice && notice !== 'Saved.'

  return (
    <div className="space-y-4 pb-6">
      {entries.length <= 2 && (
        <Notice tone="info">
          The full list of settings is generated the first time the server starts. You can already
          set the common ones below.
        </Notice>
      )}

      <Card title="Common settings">
        <div className="divide-y divide-border-soft">
          {COMMON.map((def) => (
            <PropertyRow
              key={def.key}
              def={def}
              value={get(def.key)}
              onChange={(v) => set(def.key, v)}
            />
          ))}
        </div>
      </Card>

      <Card title={`Advanced: all other properties (${advanced.length})`}>
        <Table>
          <thead>
            <tr>
              <Th>Key</Th>
              <Th>Value</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {advanced.map((entry) => (
              <tr key={entry.key} className={trClass}>
                <Td className="font-mono text-text-2">{entry.key}</Td>
                <Td>
                  <input
                    className={inputClass}
                    value={entry.value}
                    onChange={(e) => set(entry.key, e.target.value)}
                  />
                </Td>
                <Td>
                  <Button
                    variant="ghost"
                    aria-label={`Remove ${entry.key}`}
                    onClick={() => remove(entry.key)}
                  >
                    ✕
                  </Button>
                </Td>
              </tr>
            ))}
            <tr className={trClass}>
              <Td className="font-mono text-text-2">
                <input
                  className={`${inputClass} font-mono text-xs`}
                  placeholder="new-key"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value.trim())}
                />
              </Td>
              <Td>
                <input
                  className={inputClass}
                  placeholder="value"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                />
              </Td>
              <Td>
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
              </Td>
            </tr>
          </tbody>
        </Table>
      </Card>

      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex items-center justify-end gap-3">
        {notice && <Notice tone={restartNeeded ? 'warn' : 'ok'}>{notice}</Notice>}
        <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}

function PropertyRow({
  def,
  value,
  onChange
}: {
  def: CommonProperty
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-sm text-text">{def.label}</div>
        <div className="font-mono text-xs text-faint">{def.key}</div>
        {def.hint && <div className="mt-0.5 text-xs text-faint">{def.hint}</div>}
      </div>
      <div className="w-56 shrink-0">
        {def.kind === 'bool' ? (
          <div className="flex justify-end">
            <Switch
              checked={value === 'true'}
              onChange={(v) => onChange(v ? 'true' : 'false')}
              label={def.label}
            />
          </div>
        ) : def.kind === 'select' ? (
          <select
            className={`${inputClass} pr-8`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            {def.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={`${inputClass} ${def.kind === 'number' ? 'font-mono' : ''}`}
            type={def.kind === 'number' ? 'number' : 'text'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
    </div>
  )
}

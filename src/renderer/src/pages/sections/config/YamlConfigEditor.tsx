import { useEffect, useMemo, useState } from 'react'
import { parseDocument } from 'yaml'
import type {
  ConfigFileContent,
  ConfigFileInfo,
  ConfigNode,
  ConfigValue,
  ServerView
} from '../../../../../shared/types'
import { ErrorText, inputClass, Card, Segmented, Switch, TextLink } from '../../../components/ui'
import { useToast } from '../../../components/Toaster'
import { api, errorMessage } from '../../../lib/api'
import { pathKey, yamlSections } from '../../../lib/yamlTree'
import { ConfigRail, scrollToSection, useScrollSpy } from './ConfigRail'
import { ConfigSaveBar, useSavedToast } from './ConfigSaveBar'

type Mode = 'form' | 'raw'

export function YamlConfigEditor({
  server,
  file,
  onDirtyChange
}: {
  server: ServerView
  file: ConfigFileInfo
  onDirtyChange: (count: number) => void
}) {
  const toast = useToast()
  const savedToast = useSavedToast(server)
  const [content, setContent] = useState<ConfigFileContent | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('form')
  const [edits, setEdits] = useState<Map<string, ConfigValue>>(new Map())
  const [raw, setRaw] = useState('')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)

  function load() {
    return api.readConfigFile(server.id, file.id).then((c) => {
      setContent(c)
      setRaw(c.text)
      setEdits(new Map())
      if (c.error) setMode('raw')
    })
  }

  useEffect(() => {
    load().catch((err) => setLoadError(errorMessage(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, file.id])

  const rawDirty = content !== null && raw !== content.text
  const changes = mode === 'form' ? edits.size : rawDirty ? 1 : 0
  useEffect(() => onDirtyChange(changes), [changes, onDirtyChange])

  const rawError = useMemo(
    () => (mode === 'raw' ? parseDocument(raw).errors[0]?.message : undefined),
    [mode, raw]
  )
  const sections = useMemo(
    () => (content ? yamlSections(content.nodes, query, edits) : []),
    [content, query, edits]
  )
  const anchor = (id: string): string => `cfg-${file.id}-${id}`
  const active = useScrollSpy(mode === 'form' ? sections.map((s) => anchor(s.id)) : [])

  function edit(node: ConfigNode, value: ConfigValue) {
    setEdits((prev) => {
      const next = new Map(prev)
      if (JSON.stringify(value) === JSON.stringify(node.value)) next.delete(pathKey(node.path))
      else next.set(pathKey(node.path), value)
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      await api.writeConfigFile(
        server.id,
        file.id,
        mode === 'raw'
          ? { mode: 'raw', text: raw }
          : {
              mode: 'values',
              edits: [...edits].map(([key, value]) => ({
                path: JSON.parse(key) as string[],
                value: Array.isArray(value) ? value.filter((item) => item.trim() !== '') : value
              }))
            }
      )
      await load()
      savedToast()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (!content)
    return loadError ? (
      <ErrorText>{loadError}</ErrorText>
    ) : (
      <p className="text-sm text-faint">Loading…</p>
    )

  const canSwitch = changes === 0 && !content.error
  const toggle = (
    <div title={canSwitch ? undefined : 'Save or discard your changes first'}>
      <Segmented<Mode>
        label="Editor mode"
        options={[
          { value: 'form', label: 'Form' },
          { value: 'raw', label: 'Raw' }
        ]}
        value={mode}
        onChange={(m) => canSwitch && setMode(m)}
      />
    </div>
  )

  if (mode === 'raw')
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-faint">{file.path}</span>
          {toggle}
        </div>
        {content.error && !rawDirty && (
          <ErrorText>This file is not valid YAML: {content.error}</ErrorText>
        )}
        <textarea
          className={`${inputClass} h-[60vh] font-mono text-xs leading-relaxed`}
          spellCheck={false}
          aria-label={`${file.label} contents`}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
        <ConfigSaveBar
          count={changes}
          saving={saving}
          blocked={rawError ? `Invalid YAML: ${rawError}` : undefined}
          onSave={() => void save()}
          onDiscard={() => setRaw(content.text)}
        />
      </div>
    )

  return (
    <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-6">
      <ConfigRail
        query={query}
        onQuery={setQuery}
        placeholder={`Search ${file.label}`}
        items={sections.map((s) => ({ id: anchor(s.id), label: s.label, count: s.count }))}
        active={active}
        onSelect={scrollToSection}
      />
      <div className="min-w-0 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-faint">{file.path}</span>
          {toggle}
        </div>
        {sections.length === 0 && (
          <p className="text-sm text-faint">
            {query ? `No settings match “${query}”.` : 'This file has no settings.'}
          </p>
        )}
        {sections.map((section) => (
          <section key={section.id} id={anchor(section.id)} className="scroll-mt-4">
            <Card
              title={<span className="font-mono">{section.label}</span>}
              description={section.description}
            >
              {section.groups.map((group) =>
                group.parent === '' ? (
                  <NodeList
                    key="direct"
                    nodes={group.nodes}
                    edits={edits}
                    onEdit={edit}
                    onRaw={() => canSwitch && setMode('raw')}
                  />
                ) : (
                  <details
                    key={`${group.parent}:${query ? 'q' : ''}`}
                    open={!!query}
                    className="group border-t border-border-soft first:border-t-0"
                  >
                    <summary className="cursor-pointer py-2.5 font-mono text-xs text-text-2 hover:text-text">
                      {group.parent} <span className="text-faint">({group.nodes.length})</span>
                    </summary>
                    <div className="pl-4">
                      <NodeList
                        nodes={group.nodes}
                        edits={edits}
                        onEdit={edit}
                        onRaw={() => canSwitch && setMode('raw')}
                      />
                    </div>
                  </details>
                )
              )}
            </Card>
          </section>
        ))}
        <ConfigSaveBar
          count={changes}
          saving={saving}
          onSave={() => void save()}
          onDiscard={() => setEdits(new Map())}
        />
      </div>
    </div>
  )
}

function NodeList({
  nodes,
  edits,
  onEdit,
  onRaw
}: {
  nodes: ConfigNode[]
  edits: Map<string, ConfigValue>
  onEdit: (node: ConfigNode, value: ConfigValue) => void
  onRaw: () => void
}) {
  return (
    <div className="divide-y divide-border-soft">
      {nodes.map((node) => {
        const edited = edits.get(pathKey(node.path))
        const value = edited ?? node.value
        const wide = node.kind === 'list' || node.kind === 'complex'
        return (
          <div
            key={pathKey(node.path)}
            className={wide ? 'space-y-2 py-3' : 'flex items-center justify-between gap-4 py-3'}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-mono text-[13px] text-text">
                {node.path.at(-1)}
                {edited !== undefined && (
                  <span className="font-sans text-[11px] font-medium text-accent">Modified</span>
                )}
              </div>
              {node.comment && (
                <div className="mt-0.5 whitespace-pre-line text-xs text-faint">{node.comment}</div>
              )}
            </div>
            <div className={wide ? '' : 'w-56 shrink-0'}>
              <ValueInput
                node={node}
                value={value}
                onChange={(v) => onEdit(node, v)}
                onRaw={onRaw}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ValueInput({
  node,
  value,
  onChange,
  onRaw
}: {
  node: ConfigNode
  value: ConfigValue | undefined
  onChange: (value: ConfigValue) => void
  onRaw: () => void
}) {
  const label = node.path.join('.')
  switch (node.kind) {
    case 'bool':
      return (
        <div className="flex justify-end">
          <Switch checked={value === true} onChange={onChange} label={label} />
        </div>
      )
    case 'number':
      return (
        <NumberInput
          label={label}
          value={value as number}
          float={/\./.test(node.source ?? '')}
          onChange={onChange}
        />
      )
    case 'string':
      return (
        <input
          className={inputClass}
          aria-label={label}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'list':
      return (
        <textarea
          className={`${inputClass} font-mono text-xs`}
          aria-label={`${label} (one per line)`}
          rows={Math.min(8, Math.max(2, (value as string[]).length + 1))}
          value={(value as string[]).join('\n')}
          onChange={(e) => onChange(e.target.value.split('\n'))}
        />
      )
    default:
      return (
        <div className="space-y-1">
          <pre className="max-h-40 overflow-auto rounded-btn border border-border-soft bg-panel-2 p-2 font-mono text-xs text-text-2">
            {String(value ?? '') || '(empty)'}
          </pre>
          <TextLink onClick={onRaw}>Edit in Raw</TextLink>
        </div>
      )
  }
}

function NumberInput({
  label,
  value,
  float,
  onChange
}: {
  label: string
  value: number
  float: boolean
  onChange: (value: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    if (Number(text) !== value) setText(String(value))
    // only resync when the value changes from outside (e.g. Discard)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input
      className={`${inputClass} font-mono`}
      type="number"
      step={float ? 'any' : 1}
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(float ? n : Math.round(n))
      }}
      onBlur={() => setText(String(value))}
    />
  )
}

import { useEffect, useState } from 'react'
import type { ServerView, SystemInfo } from '../../../../shared/types'
import { Button, ErrorText, Field, inputClass } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { formatRam, maxRamMb } from '../../lib/format'

interface Props {
  server: ServerView
  onChanged: () => void
  onDeleted: () => void
}

export function SettingsTab({ server, onChanged, onDeleted }: Props) {
  const [sys, setSys] = useState<SystemInfo | null>(null)
  const [ramMb, setRamMb] = useState(server.ramMb)
  const [jvmArgs, setJvmArgs] = useState(server.jvmArgs.join(' '))
  const [javaPath, setJavaPath] = useState<string | undefined>(server.javaPath)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [keepFiles, setKeepFiles] = useState(true)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    api
      .systemInfo()
      .then(setSys)
      .catch(() => {})
  }, [])

  const dirty =
    ramMb !== server.ramMb ||
    jvmArgs.trim() !== server.jvmArgs.join(' ') ||
    javaPath !== server.javaPath
  const stopped = server.status === 'stopped' || server.status === 'crashed'
  const ramMax = Math.max(sys ? maxRamMb(sys.totalRamMb) : 16384, server.ramMb)

  async function save() {
    setSaving(true)
    setError(null)
    setNotice(null)
    setWarning(null)
    try {
      const result = await api.updateServer(server.id, {
        ramMb,
        jvmArgs: jvmArgs.split(/\s+/).filter(Boolean),
        javaPath: javaPath ?? null
      })
      setWarning(result.warning ?? null)
      setNotice(stopped ? 'Saved.' : 'Saved. Changes apply the next time the server starts.')
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function browseJava() {
    const picked = await api.pickJava()
    if (picked) setJavaPath(picked)
  }

  async function remove() {
    setDeleting(true)
    setError(null)
    try {
      await api.removeServer(server.id, keepFiles)
      onDeleted()
    } catch (err) {
      setError(errorMessage(err))
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6 pb-6">
      <Field label={`Memory: ${formatRam(ramMb)}`}>
        <input
          type="range"
          className="w-full accent-emerald-500"
          min={1024}
          max={ramMax}
          step={512}
          value={ramMb}
          onChange={(e) => setRamMb(Number(e.target.value))}
        />
      </Field>

      <Field
        label="Java"
        hint={
          javaPath
            ? 'Using a custom Java. Make sure its version matches what this Minecraft version needs.'
            : 'Blockhost downloads and uses the right Java version automatically.'
        }
      >
        <div className="flex gap-2">
          <input
            className={inputClass}
            readOnly
            value={javaPath ?? 'Automatic (Eclipse Temurin)'}
          />
          <Button onClick={() => void browseJava()}>Browse…</Button>
          {javaPath && <Button onClick={() => setJavaPath(undefined)}>Use automatic</Button>}
        </div>
      </Field>

      <Field label="Extra JVM arguments" hint="Advanced. Separate with spaces, e.g. -XX:+UseG1GC">
        <input
          className={`${inputClass} font-mono`}
          value={jvmArgs}
          onChange={(e) => setJvmArgs(e.target.value)}
          placeholder="-XX:+UseG1GC"
        />
      </Field>

      {warning && <p className="text-sm text-amber-300">{warning}</p>}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
        <Button
          onClick={() => void api.openFolder(server.id).catch((err) => setError(errorMessage(err)))}
        >
          Open server folder
        </Button>
        {notice && <span className="text-sm text-emerald-400">{notice}</span>}
      </div>

      <section className="space-y-3 rounded-md border border-red-900/60 p-4">
        <h3 className="font-medium text-red-300">Delete server</h3>
        {!confirmDelete ? (
          <Button variant="danger" disabled={!stopped} onClick={() => setConfirmDelete(true)}>
            Delete…
          </Button>
        ) : (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={keepFiles}
                onChange={(e) => setKeepFiles(e.target.checked)}
              />
              Keep the world and files on disk ({server.dir})
            </label>
            <div className="flex gap-2">
              <Button variant="danger" disabled={deleting} onClick={() => void remove()}>
                {keepFiles ? 'Remove from Blockhost' : 'Delete server and files'}
              </Button>
              <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {!stopped && <p className="text-xs text-zinc-500">Stop the server before deleting it.</p>}
      </section>
    </div>
  )
}

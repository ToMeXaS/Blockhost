import { useEffect, useState } from 'react'
import type { BackupList, ServerView, SystemInfo } from '../../../../shared/types'
import { useToast } from '../../components/Toaster'
import { Button, Card, Field, inputClass } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'
import { formatBytes, formatRam, maxRamMb } from '../../lib/format'

interface Props {
  server: ServerView
  onChanged: () => void
  onDeleted: () => void
}

export function SettingsSection({ server, onChanged, onDeleted }: Props) {
  const toast = useToast()
  const [sys, setSys] = useState<SystemInfo | null>(null)
  const [ramMb, setRamMb] = useState(server.ramMb)
  const [limitOn, setLimitOn] = useState(server.diskLimitMb !== undefined)
  const [limitGb, setLimitGb] = useState(String((server.diskLimitMb ?? 10_240) / 1024))
  const [jvmArgs, setJvmArgs] = useState(server.jvmArgs.join(' '))
  const [javaPath, setJavaPath] = useState<string | undefined>(server.javaPath)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [keepFiles, setKeepFiles] = useState(true)
  const [backups, setBackups] = useState<BackupList | null>(null)
  const [deleteBackups, setDeleteBackups] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    api
      .systemInfo()
      .then(setSys)
      .catch(() => {})
  }, [])

  const limitValue = Number(limitGb)
  const limitValid = Number.isInteger(limitValue) && limitValue >= 1 && limitValue <= 10_240
  const diskLimitMb = limitOn ? limitValue * 1024 : undefined
  const dirty =
    ramMb !== server.ramMb ||
    diskLimitMb !== server.diskLimitMb ||
    jvmArgs.trim() !== server.jvmArgs.join(' ') ||
    javaPath !== server.javaPath
  const stopped = server.status === 'stopped' || server.status === 'crashed'
  const ramMax = Math.max(sys ? maxRamMb(sys.totalRamMb) : 16384, server.ramMb)

  async function save() {
    setSaving(true)
    try {
      const result = await api.updateServer(server.id, {
        ramMb,
        diskLimitMb: diskLimitMb ?? null,
        jvmArgs: jvmArgs.split(/\s+/).filter(Boolean),
        javaPath: javaPath ?? null
      })
      toast.success(stopped ? 'Saved.' : 'Saved. Changes apply the next time the server starts.')
      if (result.warning) toast.warn(result.warning)
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
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
    try {
      await api.removeServer(
        server.id,
        keepFiles,
        deleteBackups && backups !== null && backups.items.length > 0
      )
      onDeleted()
    } catch (err) {
      toast.error(errorMessage(err))
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="Memory, disk & Java"
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              void api.openFolder(server.id).catch((err) => toast.error(errorMessage(err)))
            }
          >
            Open server folder
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label={`Memory: ${formatRam(ramMb)}`}>
            <input
              type="range"
              className="accent-accent w-full"
              min={1024}
              max={ramMax}
              step={512}
              value={ramMb}
              onChange={(e) => setRamMb(Number(e.target.value))}
            />
          </Field>

          <Field
            label="Disk limit"
            hint={
              limitOn && !limitValid
                ? 'Enter a whole number of GB between 1 and 10240.'
                : 'Warns when the server folder gets close, and stops it from starting once it is over.'
            }
          >
            <div className="flex items-center gap-3">
              <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm text-text-2">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={limitOn}
                  onChange={(e) => setLimitOn(e.target.checked)}
                />
                Limit disk usage
              </label>
              <div className="w-28">
                <input
                  type="number"
                  aria-label="Disk limit in GB"
                  className={`${inputClass} font-mono disabled:opacity-50`}
                  min={1}
                  max={10_240}
                  step={1}
                  disabled={!limitOn}
                  value={limitGb}
                  onChange={(e) => setLimitGb(e.target.value)}
                />
              </div>
              <span className="text-sm text-text-2">GB</span>
            </div>
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
                className={`${inputClass} font-mono`}
                readOnly
                value={javaPath ?? 'Automatic (Eclipse Temurin)'}
              />
              <Button onClick={() => void browseJava()}>Browse…</Button>
              {javaPath && <Button onClick={() => setJavaPath(undefined)}>Use automatic</Button>}
            </div>
          </Field>

          <Field
            label="Extra JVM arguments"
            hint="Advanced. Separate with spaces, e.g. -XX:+UseG1GC"
          >
            <input
              className={`${inputClass} font-mono`}
              value={jvmArgs}
              onChange={(e) => setJvmArgs(e.target.value)}
              placeholder="-XX:+UseG1GC"
            />
          </Field>

          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={!dirty || saving || (limitOn && !limitValid)}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </div>
      </Card>

      <section className="rounded-card border border-bad-border bg-bad-bg/40 p-5 space-y-3">
        <h3 className="text-[15px] font-semibold text-danger">Delete server</h3>
        {!confirmDelete ? (
          <Button
            variant="danger"
            disabled={!stopped}
            onClick={() => {
              setConfirmDelete(true)
              setDeleteBackups(false)
              setBackups(null)
              api
                .backupsList(server.id)
                .then(setBackups)
                .catch(() => setBackups(null))
            }}
          >
            Delete…
          </Button>
        ) : (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-text-2">
              <input
                type="checkbox"
                className="accent-accent"
                checked={keepFiles}
                onChange={(e) => setKeepFiles(e.target.checked)}
              />
              Keep the world and files on disk ({server.dir})
            </label>
            {backups && backups.items.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-text-2">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={deleteBackups}
                  onChange={(e) => setDeleteBackups(e.target.checked)}
                />
                Also delete {backups.items.length}{' '}
                {backups.items.length === 1 ? 'backup' : 'backups'} (
                {formatBytes(backups.items.reduce((sum, b) => sum + b.bytes, 0))})
              </label>
            )}
            <div className="flex gap-2">
              <Button variant="danger" disabled={deleting} onClick={() => void remove()}>
                {keepFiles ? 'Remove from Blockhost' : 'Delete server and files'}
              </Button>
              <Button
                onClick={() => {
                  setConfirmDelete(false)
                  setDeleteBackups(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {!stopped && <p className="text-xs text-faint">Stop the server before deleting it.</p>}
      </section>
    </div>
  )
}

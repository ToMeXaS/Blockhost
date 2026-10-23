import { useEffect, useState } from 'react'
import {
  BACKUP_INTERVALS,
  DEFAULT_BACKUP_SETTINGS,
  type BackupInfo,
  type BackupKind,
  type BackupLocation,
  type ServerView
} from '../../../../shared/types'
import { MoreIcon } from '../../components/icons'
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  inputClass,
  Menu,
  Notice,
  Table,
  Td,
  Th,
  trClass
} from '../../components/ui'
import { useToast } from '../../components/Toaster'
import { useBackups } from '../../hooks/useBackups'
import { api, errorMessage } from '../../lib/api'
import { formatAgo, formatBytes } from '../../lib/format'

const KIND_LABEL: Record<BackupKind, string> = {
  manual: 'Manual',
  auto: 'Automatic',
  'pre-restore': 'Before restore'
}
const KIND_TONE = { manual: 'neutral', auto: 'accent', 'pre-restore': 'warn' } as const

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

type Pending =
  | { action: 'restore'; backup: BackupInfo }
  | { action: 'delete'; backup: BackupInfo }
  | { action: 'restoreAsNew'; backup: BackupInfo; name: string; dir: string; port: string }

interface Props {
  server: ServerView
  onChanged: () => void
}

export function BackupsSection({ server, onChanged }: Props) {
  const toast = useToast()
  const { list, progress, error: loadError, clearProgress } = useBackups(server.id)
  const settings = server.backup ?? DEFAULT_BACKUP_SETTINGS
  const [interval, setIntervalHours] = useState<number | null>(settings.intervalHours)
  const [keep, setKeep] = useState(String(settings.keep))
  const [location, setLocation] = useState<BackupLocation | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    api
      .backupsLocation()
      .then(setLocation)
      .catch(() => {})
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const stopped = server.status === 'stopped' || server.status === 'crashed'
  const keepValue = Number(keep)
  const keepValid = Number.isInteger(keepValue) && keepValue >= 1 && keepValue <= 100
  const scheduleDirty = interval !== settings.intervalHours || keepValue !== settings.keep

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      clearProgress()
      setBusy(false)
    }
  }

  const backUpNow = () =>
    run(async () => {
      await api.backupsCreate(server.id)
      toast.success('Backup created.')
    })

  const saveSchedule = () =>
    run(async () => {
      await api.updateServer(server.id, { backup: { intervalHours: interval, keep: keepValue } })
      toast.success('Schedule saved.')
      onChanged()
    })

  const startRestoreAsNew = (backup: BackupInfo) =>
    run(async () => {
      const [info, meta] = await Promise.all([
        api.systemInfo(),
        api.backupsMeta(server.id, backup.file)
      ])
      if (!meta) {
        toast.error(
          'This backup was not made by Blockhost, so it can only be restored over this server.'
        )
        return
      }
      const name = `${meta.server.name} (restored)`.slice(0, 48)
      const slug = name.replace(/[^\w.-]+/g, '-').replace(/-+$/, '')
      setPending({
        action: 'restoreAsNew',
        backup,
        name,
        dir: `${info.defaultServersDir}\\${slug}`,
        port: String(server.port + 1)
      })
    })

  const confirm = () =>
    run(async () => {
      if (!pending) return
      if (pending.action === 'delete') {
        await api.backupsDelete(server.id, pending.backup.file)
        toast.success('Backup deleted.')
      } else if (pending.action === 'restore') {
        await api.backupsRestore(server.id, pending.backup.file)
        toast.success('Backup restored. The previous state was saved as a "Before restore" backup.')
        onChanged()
      } else {
        const rec = await api.backupsRestoreAsNew(server.id, pending.backup.file, {
          name: pending.name,
          dir: pending.dir,
          port: Number(pending.port)
        })
        toast.success(`Restored as "${rec.name}". You'll find it in your server list.`)
        onChanged()
      }
      setPending(null)
    })

  const changeLocation = (reset: boolean) =>
    run(async () => {
      setLocation(await (reset ? api.backupsResetLocation() : api.backupsPickLocation()))
    })

  const items = list?.items ?? []
  const working = busy || progress !== null
  // A restore first backs up the current state, so its progress runs twice.
  const progressLabel =
    progress?.op === 'restore'
      ? 'Restoring…'
      : pending?.action === 'restore'
        ? 'Saving the current state…'
        : 'Backing up…'

  return (
    <div className="space-y-4">
      <Card
        title="Backups"
        description="Each backup is a zip of the whole server folder, except logs and caches."
        actions={
          <>
            <Button
              onClick={() =>
                void api.backupsOpenFolder(server.id).catch((e) => toast.error(errorMessage(e)))
              }
            >
              Open folder
            </Button>
            <Button variant="primary" disabled={working} onClick={() => void backUpNow()}>
              Back up now
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {progress && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[13px]">
                <span className="text-text-2">{progressLabel}</span>
                <span className="font-mono text-muted">{progress.percent}%</span>
              </div>
              <div
                role="progressbar"
                aria-label={progressLabel}
                aria-valuenow={progress.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 overflow-hidden rounded-full bg-panel-2"
              >
                <span
                  className="block h-full rounded-full bg-accent transition-[width]"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}
          {list?.lastAutoFailure && (
            <Notice tone="warn">
              The last automatic backup failed{' '}
              {formatAgo(now - Date.parse(list.lastAutoFailure.at))}: {list.lastAutoFailure.message}
            </Notice>
          )}
          {loadError && <ErrorText>{loadError}</ErrorText>}

          {pending && (
            <div className="space-y-3 rounded-btn border border-border-strong bg-panel-2 p-4">
              {pending.action === 'delete' && (
                <p className="text-sm text-text-2">
                  Delete the backup from {formatDate(pending.backup.createdAt)}? This can't be
                  undone.
                </p>
              )}
              {pending.action === 'restore' && (
                <p className="text-sm text-text-2">
                  Replace this server's files with the backup from{' '}
                  {formatDate(pending.backup.createdAt)}? The current state is saved as a "Before
                  restore" backup first.
                </p>
              )}
              {pending.action === 'restoreAsNew' && (
                <p className="text-sm text-text-2">
                  Create a new server from the backup from {formatDate(pending.backup.createdAt)}.
                  This server is left untouched.
                </p>
              )}
              {pending.action === 'restoreAsNew' && (
                <div className="grid gap-3 min-[800px]:grid-cols-[2fr_3fr_1fr]">
                  <Field label="Name">
                    <input
                      className={inputClass}
                      value={pending.name}
                      onChange={(e) => setPending({ ...pending, name: e.target.value })}
                    />
                  </Field>
                  <Field label="Folder" hint="Must be empty or not exist yet.">
                    <input
                      className={`${inputClass} font-mono`}
                      value={pending.dir}
                      onChange={(e) => setPending({ ...pending, dir: e.target.value })}
                    />
                  </Field>
                  <Field label="Port">
                    <input
                      type="number"
                      className={`${inputClass} font-mono`}
                      value={pending.port}
                      onChange={(e) => setPending({ ...pending, port: e.target.value })}
                    />
                  </Field>
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  variant={pending.action === 'delete' ? 'danger' : 'primary'}
                  disabled={working}
                  onClick={() => void confirm()}
                >
                  {pending.action === 'delete'
                    ? 'Delete backup'
                    : pending.action === 'restore'
                      ? 'Restore'
                      : 'Create server'}
                </Button>
                <Button disabled={working} onClick={() => setPending(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {list === null && !loadError ? (
            <p className="text-sm text-faint">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-faint">No backups yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Created</Th>
                  <Th>Type</Th>
                  <Th className="text-right">Size</Th>
                  <Th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {items.map((backup) => (
                  <tr key={backup.file} className={trClass}>
                    <Td>
                      <span className="text-text">{formatDate(backup.createdAt)}</span>
                      <span className="ml-2 text-faint">
                        {formatAgo(now - Date.parse(backup.createdAt))}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={KIND_TONE[backup.kind]}>{KIND_LABEL[backup.kind]}</Badge>
                    </Td>
                    <Td className="text-right font-mono">{formatBytes(backup.bytes)}</Td>
                    <Td>
                      <Menu
                        label="Backup actions"
                        align="right"
                        buttonClassName="inline-flex h-8 w-8 items-center justify-center rounded-btn text-text-2 transition-colors hover:bg-panel-2"
                        button={<MoreIcon className="h-4 w-4" />}
                        items={[
                          {
                            label: 'Restore',
                            hint: stopped ? undefined : 'Stop the server first',
                            disabled: !stopped || working,
                            onSelect: () => setPending({ action: 'restore', backup })
                          },
                          {
                            label: 'Restore as new server',
                            disabled: working,
                            onSelect: () => void startRestoreAsNew(backup)
                          },
                          {
                            label: 'Show in folder',
                            onSelect: () =>
                              void api
                                .backupsReveal(server.id, backup.file)
                                .catch((e) => toast.error(errorMessage(e)))
                          },
                          'divider',
                          {
                            label: 'Delete',
                            danger: true,
                            disabled: working,
                            onSelect: () => setPending({ action: 'delete', backup })
                          }
                        ]}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Card>

      <Card
        title="Automatic backups"
        description="Made only while the server is running. Manual backups are never deleted automatically."
      >
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Back up every">
            <select
              className={`${inputClass} w-40`}
              value={interval ?? ''}
              onChange={(e) => setIntervalHours(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Off</option>
              {BACKUP_INTERVALS.map((h) => (
                <option key={h} value={h}>
                  {h === 1 ? '1 hour' : `${h} hours`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Keep the last" hint={keepValid ? undefined : 'Enter 1 to 100.'}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                aria-label="Automatic backups to keep"
                className={`${inputClass} w-24 font-mono`}
                min={1}
                max={100}
                value={keep}
                onChange={(e) => setKeep(e.target.value)}
              />
              <span className="whitespace-nowrap text-sm text-text-2">automatic backups</span>
            </div>
          </Field>
          <Button
            variant="primary"
            disabled={!scheduleDirty || !keepValid || busy}
            onClick={() => void saveSchedule()}
          >
            Save schedule
          </Button>
        </div>
      </Card>

      {location && (
        <Card
          title="Backup folder"
          description="Applies to all servers. Existing backups stay in the old folder."
          actions={
            <>
              {!location.isDefault && (
                <Button disabled={working} onClick={() => void changeLocation(true)}>
                  Use default
                </Button>
              )}
              <Button disabled={working} onClick={() => void changeLocation(false)}>
                Change…
              </Button>
            </>
          }
        >
          <p
            title={location.dir}
            className="truncate rounded-btn border border-border-soft bg-sidebar px-3 py-2 font-mono text-[13px] text-text-2"
          >
            {location.dir}
          </p>
        </Card>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import {
  SERVER_TYPES,
  SERVER_TYPE_LABELS,
  TYPES_WITH_BUILDS,
  type ServerType,
  type ServerView,
  type SystemInfo,
  type VersionInfo
} from '../../../shared/types'
import { InstallPanel } from '../components/InstallPanel'
import { Button, Card, ErrorText, Field, inputClass } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { defaultRamMb, formatRam, maxRamMb, TYPE_BLURB } from '../lib/format'

interface Props {
  servers: ServerView[]
  onCancel: () => void
  onCreated: () => void
  onOpen: (id: string) => void
}

const EULA_URL = 'https://aka.ms/MinecraftEULA'
const NAME_PATTERN = /^[\w .()-]+$/
const RESERVED_DEVICE_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i
const STEP_TITLES = ['Type & version', 'Settings', 'Install']

function firstFreePort(servers: ServerView[]): number {
  const used = new Set(servers.map((s) => s.port))
  let port = 25565
  while (used.has(port)) port++
  return port
}

export function NewServerWizard({ servers, onCancel, onCreated, onOpen }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [sys, setSys] = useState<SystemInfo | null>(null)
  const [type, setType] = useState<ServerType>('paper')
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [showSnapshots, setShowSnapshots] = useState(false)
  const [version, setVersion] = useState('')
  const [builds, setBuilds] = useState<VersionInfo[]>([])
  const [build, setBuild] = useState('')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [parentDir, setParentDir] = useState('')
  const [ramMb, setRamMb] = useState(2048)
  const [port, setPort] = useState(() => firstFreePort(servers))
  const [portFree, setPortFree] = useState<boolean | null>(null)
  const [eula, setEula] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)

  useEffect(() => {
    api
      .systemInfo()
      .then((info) => {
        setSys(info)
        setParentDir(info.defaultServersDir)
        setRamMb(defaultRamMb(info.totalRamMb))
      })
      .catch((err) => setError(errorMessage(err)))
  }, [])

  useEffect(() => {
    let cancelled = false
    setVersionsLoading(true)
    setVersions([])
    setVersion('')
    setError(null)
    api
      .listVersions(type)
      .then((list) => {
        if (cancelled) return
        setVersions(list)
        setVersion(list.find((v) => v.stable)?.id ?? list[0]?.id ?? '')
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [type])

  useEffect(() => {
    setBuilds([])
    setBuild('')
    if (!version || !TYPES_WITH_BUILDS.includes(type)) return
    let cancelled = false
    api
      .listBuilds(type, version)
      .then((list) => {
        if (!cancelled) setBuilds(list)
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [type, version])

  useEffect(() => {
    if (!nameTouched && version) setName(`${SERVER_TYPE_LABELS[type]} ${version}`)
  }, [type, version, nameTouched])

  useEffect(() => {
    setPortFree(null)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return
    const timer = setTimeout(() => {
      api
        .checkPort(port)
        .then(setPortFree)
        .catch(() => setPortFree(null))
    }, 300)
    return () => clearTimeout(timer)
  }, [port])

  const visibleVersions = useMemo(
    () => versions.filter((v) => showSnapshots || v.stable),
    [versions, showSnapshots]
  )
  const trimmedName = name.trim()
  const dir = `${parentDir.replace(/[\\/]+$/, '')}\\${trimmedName}`
  const nameError = !trimmedName
    ? 'Enter a name'
    : !NAME_PATTERN.test(trimmedName)
      ? 'Use letters, numbers, spaces, dots, dashes or brackets'
      : /^[. ]+$/.test(trimmedName)
        ? 'This name is not allowed'
        : /[. ]$/.test(trimmedName)
          ? 'The name cannot end with a dot or space'
          : RESERVED_DEVICE_NAMES.test(trimmedName)
            ? 'This name is reserved by Windows'
            : servers.some((s) => s.name.toLowerCase() === trimmedName.toLowerCase())
              ? 'Another server already uses this name'
              : null
  const portValid = Number.isInteger(port) && port >= 1 && port <= 65535
  const portConflict = servers.find((s) => s.port === port)
  const portHint = !portValid
    ? 'Enter a port between 1 and 65535.'
    : portConflict
      ? `Also used by "${portConflict.name}". Both can't run at the same time.`
      : portFree === false
        ? 'This port is in use by another program right now.'
        : portFree
          ? 'Port is free. 25565 is the Minecraft default.'
          : 'Checking…'
  const canCreate = !nameError && portValid && eula && !!parentDir && !!version && !creating

  async function pickFolder() {
    const picked = await api.pickFolder()
    if (picked) setParentDir(picked)
  }

  async function create() {
    setCreating(true)
    setError(null)
    try {
      const server = await api.createServer({
        name: trimmedName,
        type,
        mcVersion: version,
        build: build || undefined,
        dir,
        ramMb,
        port,
        eulaAccepted: eula
      })
      setCreatedId(server.id)
      setStep(3)
      onCreated()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6 px-8 py-7">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[26px] font-bold tracking-tight">New server</h1>
        {step === 1 && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      <ol className="flex items-center gap-2 text-[13px]">
        {STEP_TITLES.map((title, i) => {
          const n = i + 1
          const circleClass =
            n === step
              ? 'bg-accent text-accent-ink'
              : n < step
                ? 'bg-ok-bg text-ok-text'
                : 'bg-panel-2 text-faint'
          const labelClass = n <= step ? 'text-text' : 'text-faint'
          return (
            <li key={title} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-8 bg-border-strong" />}
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-xs ${circleClass}`}
              >
                {n}
              </span>
              <span className={labelClass}>{title}</span>
            </li>
          )
        })}
      </ol>

      {error && <ErrorText>{error}</ErrorText>}

      {step === 1 && (
        <Card>
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SERVER_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={t === type}
                  onClick={() => setType(t)}
                  className={`rounded-btn border p-3 text-left ${
                    t === type
                      ? 'border-accent bg-ok-bg/40'
                      : 'border-border-strong bg-sidebar hover:border-muted'
                  }`}
                >
                  <div className="text-sm font-semibold text-text">{SERVER_TYPE_LABELS[t]}</div>
                  <div className="mt-1 text-xs text-muted">{TYPE_BLURB[t]}</div>
                </button>
              ))}
            </div>

            <Field label="Minecraft version">
              <select
                className={inputClass}
                value={version}
                disabled={versionsLoading}
                onChange={(e) => setVersion(e.target.value)}
              >
                {versionsLoading && <option value="">Loading…</option>}
                {visibleVersions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id}
                    {v.stable ? '' : ' (snapshot / beta)'}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                className="accent-accent"
                checked={showSnapshots}
                onChange={(e) => setShowSnapshots(e.target.checked)}
              />
              Show snapshots and pre-releases
            </label>

            {TYPES_WITH_BUILDS.includes(type) && (
              <Field label="Build">
                <select
                  className={inputClass}
                  value={build}
                  onChange={(e) => setBuild(e.target.value)}
                >
                  <option value="">Latest stable (recommended)</option>
                  {builds.map((b) => (
                    <option key={b.id} value={b.id}>
                      #{b.id}
                      {b.stable ? '' : ' (experimental)'}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <div className="flex justify-end">
              <Button variant="primary" disabled={!version} onClick={() => setStep(2)}>
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <div className="space-y-5">
            <Field label="Server name" hint={nameError ?? undefined}>
              <input
                className={inputClass}
                value={name}
                maxLength={48}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameTouched(true)
                }}
              />
            </Field>

            <Field label="Folder" hint={`Files will be stored in ${dir}`}>
              <div className="flex gap-2">
                <input className={inputClass} value={parentDir} readOnly />
                <Button onClick={() => void pickFolder()}>Change…</Button>
              </div>
            </Field>

            <Field
              label={`Memory: ${formatRam(ramMb)}`}
              hint={
                sys
                  ? `Your PC has ${formatRam(sys.totalRamMb)} of RAM. 2–4 GB is plenty for a few friends; modpacks need 6 GB or more.`
                  : undefined
              }
            >
              <input
                type="range"
                className="w-full accent-accent"
                min={1024}
                max={sys ? maxRamMb(sys.totalRamMb) : 8192}
                step={512}
                value={ramMb}
                onChange={(e) => setRamMb(Number(e.target.value))}
              />
            </Field>

            <Field label="Port" hint={portHint}>
              <input
                type="number"
                className={`${inputClass} font-mono`}
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
              />
            </Field>

            <label className="flex items-start gap-2 text-sm text-text-2">
              <input
                type="checkbox"
                className="mt-1 accent-accent"
                checked={eula}
                onChange={(e) => setEula(e.target.checked)}
              />
              <span>
                I accept the{' '}
                <button
                  type="button"
                  className="text-link underline"
                  onClick={() => void api.openExternal(EULA_URL)}
                >
                  Minecraft End User License Agreement
                </button>
                . Mojang requires this to run a server.
              </span>
            </label>

            <div className="flex justify-between">
              <Button onClick={() => setStep(1)}>Back</Button>
              <Button variant="primary" disabled={!canCreate} onClick={() => void create()}>
                {creating ? 'Creating…' : 'Create server'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {step === 3 && createdId && (
        <InstallPanel
          serverId={createdId}
          initialState="installing"
          actions={(state) =>
            state === 'done' ? (
              <Button variant="primary" onClick={() => onOpen(createdId)}>
                Open server
              </Button>
            ) : state === 'error' ? (
              <>
                <Button
                  variant="primary"
                  onClick={() =>
                    void api.retryInstall(createdId).catch((err) => setError(errorMessage(err)))
                  }
                >
                  Retry
                </Button>
                <Button
                  variant="danger"
                  onClick={() =>
                    void api
                      .removeServer(createdId, false)
                      .then(() => {
                        onCreated()
                        onCancel()
                      })
                      .catch((err) => setError(errorMessage(err)))
                  }
                >
                  Delete
                </Button>
              </>
            ) : null
          }
        />
      )}
    </div>
  )
}

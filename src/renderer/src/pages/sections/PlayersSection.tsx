import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  PLAYER_NAME_PATTERN,
  type PlayerAction,
  type PlayerListName,
  type PlayerLists,
  type ServerView
} from '../../../../shared/types'
import {
  Avatar,
  Badge,
  Button,
  Card,
  ErrorText,
  inputClass,
  Notice,
  Segmented,
  Table,
  Td,
  Th,
  trClass
} from '../../components/ui'
import { api, ApiCallError, errorMessage } from '../../lib/api'

const LIST_FILE_NAMES: Record<PlayerListName, string> = {
  ops: 'ops.json',
  whitelist: 'whitelist.json',
  bannedPlayers: 'banned-players.json',
  bannedIps: 'banned-ips.json'
}

const NAME_HINT = 'Use the exact Minecraft username (3–16 letters, numbers or _).'
const IP_PATTERN = /^[0-9a-fA-F.:]{2,45}$/

type Pending = { type: 'kick' | 'ban'; name: string }

function Empty({ children }: { children: string }) {
  return <p className="text-sm text-faint">{children}</p>
}

function AddForm({
  placeholder,
  isValid,
  invalidMessage,
  withReason = false,
  submitLabel = 'Add',
  disabled,
  onSubmit
}: {
  placeholder: string
  isValid: (value: string) => boolean
  invalidMessage: string
  withReason?: boolean
  submitLabel?: string
  disabled: boolean
  onSubmit: (value: string, reason: string) => Promise<boolean>
}) {
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [invalid, setInvalid] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = value.trim()
    if (!isValid(trimmed)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (await onSubmit(trimmed, reason.trim())) {
      setValue('')
      setReason('')
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-3 space-y-1">
      <div className="flex gap-2">
        <input
          className={inputClass}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
        />
        {withReason && (
          <input
            className={inputClass}
            placeholder="Reason (optional)"
            maxLength={200}
            value={reason}
            disabled={disabled}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
        <Button type="submit" disabled={disabled || !value.trim()}>
          {submitLabel}
        </Button>
      </div>
      {invalid && <p className="text-xs text-danger">{invalidMessage}</p>}
    </form>
  )
}

export function PlayersSection({ server }: { server: ServerView }) {
  const [lists, setLists] = useState<PlayerLists | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [pendingReason, setPendingReason] = useState('')
  const [banView, setBanView] = useState<'players' | 'ips'>('players')

  const requestIdRef = useRef(0)
  const refresh = useCallback(() => {
    const requestId = ++requestIdRef.current
    api
      .getPlayers(server.id)
      .then((result) => {
        if (requestId !== requestIdRef.current) return // a later refresh has superseded this one
        setLists(result)
        setError(null)
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return
        setError(errorMessage(err))
      })
  }, [server.id])

  useEffect(() => refresh(), [refresh, server.status])
  useEffect(
    () =>
      api.on('players:changed', (event) => {
        if (event.serverId === server.id) refresh()
      }),
    [server.id, refresh]
  )

  const running = server.status === 'running'
  const transitioning = server.status === 'starting' || server.status === 'stopping'
  const disabled = busy || transitioning

  async function act(action: PlayerAction): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      setLists(await api.playerAction(server.id, action))
      return true
    } catch (err) {
      if (
        err instanceof ApiCallError &&
        err.code === 'LIST_FILE_CORRUPT' &&
        window.confirm(`${err.message}\n\nReplace it?`)
      ) {
        return await act({ ...action, overwriteCorrupt: true })
      }
      setError(errorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function confirmPending() {
    if (!pending) return
    const ok = await act({ type: pending.type, name: pending.name, reason: pendingReason.trim() })
    if (ok) {
      setPending(null)
      setPendingReason('')
    }
  }

  if (!lists) {
    return error ? <ErrorText>{error}</ErrorText> : <Empty>Loading…</Empty>
  }

  const isOp = (name: string) => lists.ops.some((o) => o.name.toLowerCase() === name.toLowerCase())
  const isName = (v: string) => PLAYER_NAME_PATTERN.test(v)

  return (
    <div className="space-y-4 pb-6">
      {error && <ErrorText>{error}</ErrorText>}
      {lists.corrupt.length > 0 && (
        <ErrorText>
          Could not read {lists.corrupt.map((l) => LIST_FILE_NAMES[l]).join(', ')}. The list is
          shown as empty; saving a change will replace the file.
        </ErrorText>
      )}
      {transitioning && (
        <Notice tone="warn">Player changes are paused while the server is {server.status}.</Notice>
      )}

      <div className="grid gap-4 min-[1000px]:grid-cols-2">
        <Card title={running ? `Online now (${lists.online.length})` : 'Online now'}>
          {!running ? (
            <Empty>Server is offline — changes are saved to files and apply on next start.</Empty>
          ) : lists.online.length === 0 ? (
            <Empty>No one is online.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Player</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {lists.online.map((name) => (
                  <tr key={name} className={trClass}>
                    <Td>
                      <span className="flex items-center gap-2">
                        <Avatar name={name} size={24} />
                        {name}
                        {isOp(name) && <Badge tone="accent">op</Badge>}
                      </span>
                    </Td>
                    <Td>
                      <span className="flex shrink-0 justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={disabled}
                          onClick={() => setPending({ type: 'kick', name })}
                        >
                          Kick
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={disabled}
                          onClick={() => void act({ type: isOp(name) ? 'deop' : 'op', name })}
                        >
                          {isOp(name) ? 'Deop' : 'Op'}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={disabled}
                          onClick={() => setPending({ type: 'ban', name })}
                        >
                          Ban
                        </Button>
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {pending && (
            <div className="mt-3 space-y-2 rounded-card border border-border-strong p-3">
              <p className="text-sm text-text-2">
                {pending.type === 'kick' ? 'Kick' : 'Ban'} <b>{pending.name}</b>?
              </p>
              <input
                className={inputClass}
                placeholder="Reason (optional)"
                maxLength={200}
                value={pendingReason}
                onChange={(e) => setPendingReason(e.target.value)}
              />
              <div className="flex gap-2">
                <Button variant="danger" disabled={disabled} onClick={() => void confirmPending()}>
                  {pending.type === 'kick' ? 'Kick' : 'Ban'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPending(null)
                    setPendingReason('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card title="Operators">
          {lists.ops.length === 0 ? (
            <Empty>No operators.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Operator</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {lists.ops.map((op) => (
                  <tr key={op.uuid || op.name} className={trClass}>
                    <Td>
                      <span className="flex items-center gap-2">
                        <Avatar name={op.name} size={24} />
                        {op.name}
                      </span>
                    </Td>
                    <Td>
                      <span className="flex justify-end">
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={disabled}
                          aria-label={`Remove ${op.name} from operators`}
                          onClick={() => void act({ type: 'deop', name: op.name })}
                        >
                          Remove
                        </Button>
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <AddForm
            placeholder="Username"
            isValid={isName}
            invalidMessage={NAME_HINT}
            disabled={disabled}
            onSubmit={(name) => act({ type: 'op', name })}
          />
        </Card>
      </div>

      <div className="grid gap-4 min-[1000px]:grid-cols-2">
        <Card
          title="Whitelist"
          description={
            lists.whitelistEnabled
              ? 'Only these players can join.'
              : 'Off — anyone can join. Turn it on to allow only these players.'
          }
          actions={
            <Button
              variant={lists.whitelistEnabled ? 'primary' : 'secondary'}
              disabled={disabled}
              onClick={() =>
                void act({ type: 'setWhitelistEnabled', enabled: !lists.whitelistEnabled })
              }
            >
              {lists.whitelistEnabled ? 'On' : 'Off'}
            </Button>
          }
        >
          {lists.whitelist.length === 0 ? (
            <Empty>No players on the whitelist.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Player</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {lists.whitelist.map((p) => (
                  <tr key={p.uuid || p.name} className={trClass}>
                    <Td>
                      <span className="flex items-center gap-2">
                        <Avatar name={p.name} size={24} />
                        {p.name}
                      </span>
                    </Td>
                    <Td>
                      <span className="flex justify-end">
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={disabled}
                          aria-label={`Remove ${p.name} from the whitelist`}
                          onClick={() => void act({ type: 'whitelistRemove', name: p.name })}
                        >
                          Remove
                        </Button>
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <AddForm
            placeholder="Username"
            isValid={isName}
            invalidMessage={NAME_HINT}
            disabled={disabled}
            onSubmit={(name) => act({ type: 'whitelistAdd', name })}
          />
        </Card>

        <Card
          title="Banned"
          actions={
            <Segmented
              label="Ban list"
              options={[
                { value: 'players', label: 'Players' },
                { value: 'ips', label: 'IPs' }
              ]}
              value={banView}
              onChange={setBanView}
            />
          }
        >
          {banView === 'players' ? (
            <>
              {lists.bannedPlayers.length === 0 ? (
                <Empty>No banned players.</Empty>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Player</Th>
                      <Th>Reason</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {lists.bannedPlayers.map((b) => (
                      <tr key={b.uuid || b.name} className={trClass}>
                        <Td>
                          <span className="flex items-center gap-2">
                            <Avatar name={b.name} size={24} />
                            {b.name}
                          </span>
                        </Td>
                        <Td className="text-faint">{b.reason}</Td>
                        <Td>
                          <span className="flex justify-end">
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={disabled}
                              onClick={() => void act({ type: 'pardon', name: b.name })}
                            >
                              Pardon
                            </Button>
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              <AddForm
                placeholder="Username"
                isValid={isName}
                invalidMessage={NAME_HINT}
                withReason
                submitLabel="Ban"
                disabled={disabled}
                onSubmit={(name, reason) => act({ type: 'ban', name, reason })}
              />
            </>
          ) : (
            <>
              {lists.bannedIps.length === 0 ? (
                <Empty>No banned IP addresses.</Empty>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>IP address</Th>
                      <Th>Reason</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {lists.bannedIps.map((b) => (
                      <tr key={b.ip} className={trClass}>
                        <Td className="font-mono">{b.ip}</Td>
                        <Td className="text-faint">{b.reason}</Td>
                        <Td>
                          <span className="flex justify-end">
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={disabled}
                              onClick={() => void act({ type: 'pardonIp', ip: b.ip })}
                            >
                              Pardon
                            </Button>
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              <AddForm
                placeholder="IP address"
                isValid={(v) => IP_PATTERN.test(v)}
                invalidMessage="Enter an IPv4 or IPv6 address."
                withReason
                submitLabel="Ban"
                disabled={disabled}
                onSubmit={(ip, reason) => act({ type: 'banIp', ip, reason })}
              />
            </>
          )}
        </Card>
      </div>
    </div>
  )
}

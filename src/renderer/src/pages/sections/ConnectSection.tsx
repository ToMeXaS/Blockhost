import { useEffect, useState, type ReactNode } from 'react'
import type { NetInfo, ServerView, TunnelState, TunnelStatus } from '../../../../shared/types'
import { Badge, Button, Card, ErrorText, Notice, Switch } from '../../components/ui'
import { CopyIcon } from '../../components/icons'
import { useToast } from '../../components/Toaster'
import { api, ApiCallError, errorMessage } from '../../lib/api'

const TUNNEL_BADGE: Record<
  TunnelState,
  { tone: 'accent' | 'warn' | 'danger' | 'neutral'; label: string }
> = {
  off: { tone: 'neutral', label: 'Off' },
  downloading: { tone: 'warn', label: 'Downloading' },
  connecting: { tone: 'warn', label: 'Connecting' },
  online: { tone: 'accent', label: 'Online' },
  'needs-setup': { tone: 'danger', label: 'Needs setup' },
  error: { tone: 'danger', label: 'Error' }
}

function AddressRow({
  address,
  copied,
  onCopy
}: {
  address: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="flex items-center gap-3">
      <code className="rounded-btn border border-border-soft bg-sidebar px-3 py-2 font-mono text-sm text-text">
        {address}
      </code>
      <Button size="sm" onClick={onCopy}>
        <CopyIcon className="h-3.5 w-3.5" />
        {copied ? 'Copied!' : 'Copy'}
      </Button>
    </div>
  )
}

function TunnelCard({
  server,
  onChanged,
  addressRow
}: {
  server: ServerView
  onChanged: () => void
  addressRow: (address: string) => ReactNode
}) {
  const toast = useToast()
  const [linked, setLinked] = useState<boolean | null>(null)
  const [linking, setLinking] = useState(false)
  const [status, setStatus] = useState<TunnelStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shared = server.tunnel?.enabled ?? false

  const refreshAccount = () => {
    api
      .tunnelAccount()
      .then((a) => setLinked(a.linked))
      .catch((err) => setError(errorMessage(err)))
  }

  useEffect(refreshAccount, [])
  useEffect(() => {
    api
      .tunnelStatus(server.id)
      .then(setStatus)
      .catch((err) => setError(errorMessage(err)))
  }, [server.id, server.status, shared])
  useEffect(
    () =>
      api.on('tunnel:status', (s) => {
        if (s.serverId !== server.id) return
        setStatus(s)
        if (s.state === 'error') refreshAccount()
      }),
    [server.id]
  )

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      if (!(err instanceof ApiCallError && err.code === 'CANCELLED')) toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function link() {
    setLinking(true)
    await run(async () => {
      await api.tunnelLink()
      setLinked(true)
    })
    setLinking(false)
  }

  async function unlink() {
    if (
      !window.confirm(
        'Unlink your playit.gg account from Blockhost? Shared servers will stop being reachable through playit.gg. Your tunnels stay on your playit.gg account.'
      )
    )
      return
    await run(async () => {
      await api.tunnelUnlink()
      setLinked(false)
      onChanged()
    })
  }

  const toggle = (enabled: boolean) =>
    run(async () => {
      setStatus(await api.tunnelSetShared(server.id, enabled))
      onChanged()
    })

  const retry = () =>
    run(async () => {
      setStatus(await api.tunnelRetry(server.id))
    })

  return (
    <Card
      title="Share over the internet (playit.gg)"
      description="Friends can join without port forwarding. Uses a free playit.gg account."
    >
      <div className="space-y-3">
        {error && <ErrorText>{error}</ErrorText>}

        {linked === null ? (
          <p className="text-sm text-faint">Loading…</p>
        ) : !linked ? (
          linking ? (
            <div className="flex items-center gap-3">
              <p className="text-sm text-text-2">Waiting for you to accept in the browser…</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void api.tunnelCancelLink().catch(() => {})}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {status?.state === 'error' && status.message && (
                <ErrorText>{status.message}</ErrorText>
              )}
              <Button variant="primary" disabled={busy} onClick={() => void link()}>
                Link playit.gg account
              </Button>
            </div>
          )
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Switch
                id="share-switch"
                checked={shared}
                onChange={(checked) => void toggle(checked)}
                disabled={busy}
                label="Share this server"
              />
              <label htmlFor="share-switch" className="cursor-pointer text-sm text-text">
                Share this server
              </label>
            </div>

            {status && shared && (
              <div className="space-y-2 text-sm">
                <Badge tone={TUNNEL_BADGE[status.state].tone}>
                  {TUNNEL_BADGE[status.state].label}
                </Badge>
                {status.state === 'off' &&
                  (status.address ? (
                    <div className="space-y-1 opacity-60">
                      {addressRow(status.address)}
                      <p className="text-xs text-faint">Available while the server is running.</p>
                    </div>
                  ) : (
                    <p className="text-faint">Starts when the server starts.</p>
                  ))}
                {status.state === 'downloading' && (
                  <div className="space-y-1.5">
                    <p className="text-text-2">
                      Downloading the playit agent…
                      {status.percent !== undefined ? ` ${status.percent}%` : ''}
                    </p>
                    {status.percent !== undefined && (
                      <div className="h-1.5 rounded-full bg-panel-2">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${status.percent}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
                {status.state === 'connecting' && (
                  <p className="text-text-2">Connecting to playit.gg…</p>
                )}
                {status.state === 'online' && status.address && (
                  <div className="space-y-1">
                    {addressRow(status.address)}
                    <p className="text-xs text-faint">Share this address with your friends.</p>
                  </div>
                )}
                {status.state === 'needs-setup' && (
                  <Notice tone="info">
                    <div className="space-y-2">
                      <p>
                        Create a Minecraft Java tunnel on playit.gg pointing to{' '}
                        <code className="rounded-btn bg-panel-2 px-1.5 py-0.5 font-mono">
                          {status.localAddress}
                        </code>
                        . Blockhost picks it up automatically.
                      </p>
                      <Button
                        size="sm"
                        onClick={() => void api.openExternal('https://playit.gg/account/tunnels')}
                      >
                        Open playit.gg
                      </Button>
                    </div>
                  </Notice>
                )}
                {status.state === 'error' && (
                  <div className="space-y-2">
                    <ErrorText>{status.message ?? 'Sharing failed.'}</ErrorText>
                    <Button disabled={busy} onClick={() => void retry()}>
                      Retry
                    </Button>
                  </div>
                )}
              </div>
            )}
            {!shared && <p className="text-sm text-faint">Not shared.</p>}

            <Button variant="danger" size="sm" disabled={busy} onClick={() => void unlink()}>
              Unlink playit.gg
            </Button>
          </>
        )}
      </div>
    </Card>
  )
}

export function ConnectSection({
  server,
  onChanged
}: {
  server: ServerView
  onChanged: () => void
}) {
  const [info, setInfo] = useState<NetInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    api
      .netInfo(server.port)
      .then(setInfo)
      .catch((err) => setError(errorMessage(err)))
  }, [server.port])

  async function copy(text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(text)
    setTimeout(() => setCopied((current) => (current === text ? null : current)), 1500)
  }

  const row = (address: string) => (
    <AddressRow
      key={address}
      address={address}
      copied={copied === address}
      onCopy={() => void copy(address)}
    />
  )

  return (
    <div className="space-y-4 pb-6">
      {error && <ErrorText>{error}</ErrorText>}

      <TunnelCard server={server} onChanged={onChanged} addressRow={row} />

      <Card title="On this PC">
        <div className="space-y-2">{row(`localhost:${server.port}`)}</div>
      </Card>

      <Card title="Same Wi-Fi or home network">
        <div className="space-y-2">
          {info ? (
            info.lanIps.length ? (
              info.lanIps.map((ip) => row(`${ip}:${server.port}`))
            ) : (
              <p className="text-sm text-faint">No network connection found.</p>
            )
          ) : (
            <p className="text-sm text-faint">Loading…</p>
          )}
        </div>
      </Card>

      <details className="space-y-4">
        <summary className="cursor-pointer text-sm font-medium text-text-2">
          Or forward a port yourself
        </summary>

        <Card title="Over the internet" className="mt-4">
          <div className="space-y-2">
            {info ? (
              info.publicIp ? (
                row(`${info.publicIp}:${server.port}`)
              ) : (
                <p className="text-sm text-faint">Could not detect your public IP address.</p>
              )
            ) : (
              <p className="text-sm text-faint">Loading…</p>
            )}
            <p className="text-xs text-faint">
              This only works after you forward the port on your router (see below).
            </p>
          </div>
        </Card>

        <details className="mt-4 rounded-card border border-border bg-panel p-4 text-sm text-text-2">
          <summary className="cursor-pointer font-medium text-text">
            How to let friends join over the internet
          </summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>
              Open your router&apos;s admin page. It is often{' '}
              <code className="font-mono">192.168.0.1</code> or{' '}
              <code className="font-mono">192.168.1.1</code>, and the address is usually printed on
              the router.
            </li>
            <li>
              Find the <b>Port Forwarding</b> section (sometimes called NAT or Virtual Server).
            </li>
            <li>
              Forward <b>TCP port {server.port}</b> to this PC
              {info?.lanIps[0] ? ` (${info.lanIps[0]})` : ''}.
            </li>
            <li>
              When Windows asks whether Java may communicate on networks, allow it. If you dismissed
              that prompt, allow Java under Windows Security → Firewall &amp; network protection →
              Allow an app through firewall.
            </li>
            <li>Share the internet address above with your friends.</li>
          </ol>
          <p className="mt-3 text-xs text-faint">
            Some internet providers use CGNAT, which blocks port forwarding. If it still does not
            work, ask your provider for a public IP address.
          </p>
        </details>
      </details>
    </div>
  )
}

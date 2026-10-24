import { useEffect, useState, type ReactNode } from 'react'
import type { NetInfo, ServerView, TunnelState, TunnelStatus } from '../../../../shared/types'
import { Badge, Button, Card, ErrorText, Notice, Switch } from '../../components/ui'
import { CheckIcon, ChevronDownIcon, CopyIcon } from '../../components/icons'
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

type CopyProps = { copied: boolean; onCopy: () => void }

function CopyButton({ copied, onCopy }: CopyProps) {
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? 'Copied' : 'Copy address'}
      title={copied ? 'Copied' : 'Copy'}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-btn transition-colors hover:bg-panel-2 ${copied ? 'text-accent' : 'text-muted hover:text-text'}`}
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
    </button>
  )
}

/** Compact address chip used in the smaller cards. */
function AddressRow({ address, ...copy }: CopyProps & { address: string }) {
  return (
    <div className="flex items-center gap-2 rounded-btn border border-border-soft bg-sidebar py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-sm text-text" title={address}>
        {address}
      </code>
      <CopyButton {...copy} />
    </div>
  )
}

/** The big address friends are meant to use. */
function HeroAddress({
  address,
  dim = false,
  copied,
  onCopy
}: CopyProps & { address: string; dim?: boolean }) {
  return (
    <div className={`flex items-stretch gap-2 ${dim ? 'opacity-60' : ''}`}>
      <code
        className="flex min-w-0 flex-1 items-center truncate rounded-btn border border-border-strong bg-sidebar px-4 py-3 font-mono text-lg text-text"
        title={address}
      >
        {address}
      </code>
      <Button variant="primary" className="h-auto px-4" onClick={onCopy}>
        {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
        {copied ? 'Copied!' : 'Copy'}
      </Button>
    </div>
  )
}

function TunnelCard({
  server,
  onChanged,
  heroAddress
}: {
  server: ServerView
  onChanged: () => void
  heroAddress: (address: string, dim?: boolean) => ReactNode
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

  const badge = linked && shared && status ? TUNNEL_BADGE[status.state] : null

  let body: ReactNode = null
  if (linked === null) {
    body = <p className="text-sm text-faint">Loading…</p>
  } else if (!linked) {
    body = linking ? (
      <div className="flex items-center gap-3 rounded-btn border border-border-soft bg-sidebar px-4 py-3">
        <p className="flex-1 text-sm text-text-2">Waiting for you to accept in the browser…</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void api.tunnelCancelLink().catch(() => {})}
        >
          Cancel
        </Button>
      </div>
    ) : (
      <div className="space-y-3">
        {status?.state === 'error' && status.message && <ErrorText>{status.message}</ErrorText>}
        <div className="flex flex-wrap items-center gap-4 rounded-btn border border-dashed border-border-strong px-4 py-4">
          <p className="min-w-0 flex-1 text-sm text-text-2">
            Get an address your friends can join from anywhere. No router setup needed.
          </p>
          <Button variant="primary" disabled={busy} onClick={() => void link()}>
            Link playit.gg account
          </Button>
        </div>
      </div>
    )
  } else if (!shared) {
    body = (
      <p className="rounded-btn border border-dashed border-border-strong px-4 py-4 text-sm text-faint">
        Turn on sharing to get an address friends can join from anywhere.
      </p>
    )
  } else if (!status) {
    body = <p className="text-sm text-faint">Loading…</p>
  } else if (status.state === 'off') {
    body = status.address ? (
      <div className="space-y-1.5">
        {heroAddress(status.address, true)}
        <p className="text-xs text-faint">Available while the server is running.</p>
      </div>
    ) : (
      <p className="text-sm text-faint">Starts when the server starts.</p>
    )
  } else if (status.state === 'downloading') {
    body = (
      <div className="space-y-2 text-sm">
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
    )
  } else if (status.state === 'connecting') {
    body = <p className="text-sm text-text-2">Connecting to playit.gg…</p>
  } else if (status.state === 'online' && status.address) {
    body = (
      <div className="space-y-1.5">
        {heroAddress(status.address)}
        <p className="text-xs text-faint">Share this address with your friends.</p>
      </div>
    )
  } else if (status.state === 'needs-setup') {
    body = (
      <Notice tone="info">
        <div className="space-y-2">
          <p>
            Create a Minecraft Java tunnel on playit.gg pointing to{' '}
            <code className="rounded-btn bg-panel px-1.5 py-0.5 font-mono">
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
    )
  } else if (status.state === 'error') {
    body = (
      <div className="space-y-2">
        <ErrorText>{status.message ?? 'Sharing failed.'}</ErrorText>
        <Button disabled={busy} onClick={() => void retry()}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <Card
      title="Invite friends over the internet"
      description="Through a free playit.gg account, so friends can join without port forwarding."
      actions={badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
    >
      <div className="space-y-4">
        {error && <ErrorText>{error}</ErrorText>}
        {body}

        {linked && (
          <div className="flex items-center justify-between gap-3 border-t border-border-soft pt-4">
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
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void unlink()}>
              Unlink playit.gg
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong bg-panel-2 font-mono text-xs text-text">
        {n}
      </span>
      <div className="pt-0.5">{children}</div>
    </li>
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

  const copyProps = (address: string) => ({
    copied: copied === address,
    onCopy: () => void copy(address)
  })

  const row = (address: string) => (
    <AddressRow key={address} address={address} {...copyProps(address)} />
  )

  const loading = <p className="text-sm text-faint">Loading…</p>

  return (
    <div className="space-y-4 pb-6">
      {error && <ErrorText>{error}</ErrorText>}

      <TunnelCard
        server={server}
        onChanged={onChanged}
        heroAddress={(address, dim) => (
          <HeroAddress address={address} dim={dim} {...copyProps(address)} />
        )}
      />

      <div className="grid gap-4 min-[800px]:grid-cols-2">
        <Card title="This PC" description="Join from Minecraft on this computer.">
          {row(`localhost:${server.port}`)}
        </Card>

        <Card title="Same network" description="Friends on the same Wi-Fi or home network.">
          <div className="space-y-2">
            {info ? (
              info.lanIps.length ? (
                info.lanIps.map((ip) => row(`${ip}:${server.port}`))
              ) : (
                <p className="text-sm text-faint">No network connection found.</p>
              )
            ) : (
              loading
            )}
          </div>
        </Card>
      </div>

      <details className="group rounded-card border border-border bg-panel">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden">
          <div>
            <h2 className="text-[15px] font-semibold text-text">Port forwarding</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Advanced: let friends join on your own public IP instead of playit.gg.
            </p>
          </div>
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>

        <div className="space-y-5 border-t border-border-soft p-5 text-sm text-text-2">
          <div className="space-y-1.5">
            <div className="text-[13px] font-medium text-text-2">Your internet address</div>
            {info ? (
              info.publicIp ? (
                row(`${info.publicIp}:${server.port}`)
              ) : (
                <p className="text-sm text-faint">Could not detect your public IP address.</p>
              )
            ) : (
              loading
            )}
            <p className="text-xs text-faint">
              This only works after you forward the port on your router.
            </p>
          </div>

          <ol className="space-y-3">
            <Step n={1}>
              Open your router&apos;s admin page. It is often{' '}
              <code className="font-mono">192.168.0.1</code> or{' '}
              <code className="font-mono">192.168.1.1</code>, and the address is usually printed on
              the router.
            </Step>
            <Step n={2}>
              Find the <b>Port Forwarding</b> section (sometimes called NAT or Virtual Server).
            </Step>
            <Step n={3}>
              Forward <b>TCP port {server.port}</b> to this PC
              {info?.lanIps[0] ? ` (${info.lanIps[0]})` : ''}.
            </Step>
            <Step n={4}>
              When Windows asks whether Java may communicate on networks, allow it. If you dismissed
              that prompt, allow Java under Windows Security → Firewall &amp; network protection →
              Allow an app through firewall.
            </Step>
            <Step n={5}>Share the internet address above with your friends.</Step>
          </ol>

          <p className="text-xs text-faint">
            Some internet providers use CGNAT, which blocks port forwarding. If it still does not
            work, ask your provider for a public IP address.
          </p>
        </div>
      </details>
    </div>
  )
}

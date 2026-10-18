import { useEffect, useState, type ReactNode } from 'react'
import type { NetInfo, ServerView, TunnelStatus } from '../../../../shared/types'
import { Button, ErrorText } from '../../components/ui'
import { api, ApiCallError, errorMessage } from '../../lib/api'

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
      <code className="rounded bg-zinc-900 px-3 py-1.5 font-mono text-sm">{address}</code>
      <Button variant="ghost" onClick={onCopy}>
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
    setError(null)
    try {
      await action()
    } catch (err) {
      if (!(err instanceof ApiCallError && err.code === 'CANCELLED')) setError(errorMessage(err))
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
    <section className="space-y-3 rounded-md border border-zinc-800 bg-zinc-900 p-4">
      <div>
        <h3 className="font-medium">Share over the internet (playit.gg)</h3>
        <p className="text-sm text-zinc-400">
          Friends can join without port forwarding. Uses a free playit.gg account.
        </p>
      </div>
      {error && <ErrorText>{error}</ErrorText>}

      {linked === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : !linked ? (
        linking ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-zinc-300">Waiting for you to accept in the browser…</p>
            <Button variant="ghost" onClick={() => void api.tunnelCancelLink().catch(() => {})}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {status?.state === 'error' && status.message && <ErrorText>{status.message}</ErrorText>}
            <Button variant="primary" disabled={busy} onClick={() => void link()}>
              Link playit.gg account
            </Button>
          </div>
        )
      ) : (
        <>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              role="switch"
              className="h-4 w-4 accent-emerald-500"
              checked={shared}
              disabled={busy}
              onChange={(e) => void toggle(e.target.checked)}
            />
            Share this server
          </label>

          {status && shared && (
            <div className="space-y-2 text-sm">
              {status.state === 'off' &&
                (status.address ? (
                  <div className="space-y-1 opacity-60">
                    {addressRow(status.address)}
                    <p className="text-xs text-zinc-500">Available while the server is running.</p>
                  </div>
                ) : (
                  <p className="text-zinc-500">Starts when the server starts.</p>
                ))}
              {status.state === 'downloading' && (
                <p className="text-zinc-300">
                  Downloading the playit agent…
                  {status.percent !== undefined ? ` ${status.percent}%` : ''}
                </p>
              )}
              {status.state === 'connecting' && (
                <p className="text-zinc-300">Connecting to playit.gg…</p>
              )}
              {status.state === 'online' && status.address && (
                <div className="space-y-1">
                  {addressRow(status.address)}
                  <p className="text-xs text-zinc-500">Share this address with your friends.</p>
                </div>
              )}
              {status.state === 'needs-setup' && (
                <div className="space-y-2 text-zinc-300">
                  <p>
                    Create a Minecraft Java tunnel on playit.gg pointing to{' '}
                    <code className="rounded bg-zinc-950 px-1.5 py-0.5">{status.localAddress}</code>
                    . Blockhost picks it up automatically.
                  </p>
                  <Button
                    onClick={() => void api.openExternal('https://playit.gg/account/tunnels')}
                  >
                    Open playit.gg
                  </Button>
                </div>
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
          {!shared && <p className="text-sm text-zinc-500">Not shared.</p>}

          <button
            type="button"
            className="text-xs text-zinc-500 underline hover:text-zinc-300 disabled:opacity-50"
            disabled={busy}
            onClick={() => void unlink()}
          >
            Unlink playit.gg
          </button>
        </>
      )}
    </section>
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
    <div className="max-w-2xl space-y-6 pb-6">
      {error && <ErrorText>{error}</ErrorText>}

      <TunnelCard server={server} onChanged={onChanged} addressRow={row} />

      <section className="space-y-2">
        <h3 className="font-medium">On this PC</h3>
        {row(`localhost:${server.port}`)}
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">Same Wi-Fi or home network</h3>
        {info ? (
          info.lanIps.length ? (
            info.lanIps.map((ip) => row(`${ip}:${server.port}`))
          ) : (
            <p className="text-sm text-zinc-500">No network connection found.</p>
          )
        ) : (
          <p className="text-sm text-zinc-500">Loading…</p>
        )}
      </section>

      <details className="space-y-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-300">
          Or forward a port yourself
        </summary>

        <section className="space-y-2">
          <h3 className="font-medium">Over the internet</h3>
          {info ? (
            info.publicIp ? (
              row(`${info.publicIp}:${server.port}`)
            ) : (
              <p className="text-sm text-zinc-500">Could not detect your public IP address.</p>
            )
          ) : (
            <p className="text-sm text-zinc-500">Loading…</p>
          )}
          <p className="text-xs text-zinc-500">
            This only works after you forward the port on your router (see below).
          </p>
        </section>

        <details className="rounded-md border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
          <summary className="cursor-pointer font-medium">
            How to let friends join over the internet
          </summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>
              Open your router&apos;s admin page. It is often <code>192.168.0.1</code> or{' '}
              <code>192.168.1.1</code>, and the address is usually printed on the router.
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
          <p className="mt-3 text-xs text-zinc-500">
            Some internet providers use CGNAT, which blocks port forwarding. If it still does not
            work, ask your provider for a public IP address.
          </p>
        </details>
      </details>
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { NetInfo, ServerView } from '../../../../shared/types'
import { Button, ErrorText } from '../../components/ui'
import { api, errorMessage } from '../../lib/api'

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

export function ConnectTab({ server }: { server: ServerView }) {
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
    </div>
  )
}

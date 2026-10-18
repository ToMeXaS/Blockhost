import { useEffect, useState, type ReactNode } from 'react'
import {
  CONTENT_LABELS,
  type InstalledContentList,
  type ServerView
} from '../../../../shared/types'
import { CopyIcon } from '../../components/icons'
import { LogLine } from '../../components/LogLine'
import { Avatar, Button, Card, TextLink } from '../../components/ui'
import { useCopy } from '../../hooks/useCopy'
import { useLogTail } from '../../hooks/useLogTail'
import { api } from '../../lib/api'
import { formatUptime, serverAddress, STATUS_LABEL } from '../../lib/format'
import { parseLogLevel } from '../../lib/logLevel'
import type { Section } from '../../lib/routes'

const PREVIEW_LINES = 12
const MAX_AVATARS = 8

interface Props {
  server: ServerView
  online: string[]
  runningSince?: number
  onSection: (section: Section) => void
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-text">{children}</dd>
    </div>
  )
}

export function OverviewSection({ server, online, runningSince, onSection }: Props) {
  const tail = useLogTail(server.id, PREVIEW_LINES)
  const [maxPlayers, setMaxPlayers] = useState<number | null>(null)
  const [content, setContent] = useState<InstalledContentList | null>(null)
  const [contentFailed, setContentFailed] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const { copied, copy } = useCopy()
  const contentLabel = CONTENT_LABELS[server.type]
  const address = serverAddress(server)
  const running = server.status === 'running'

  useEffect(() => {
    let alive = true
    api
      .readProperties(server.id)
      .then((entries) => {
        const raw = entries.find((e) => e.key === 'max-players')?.value
        const n = raw === undefined ? Number.NaN : Number(raw)
        if (alive) setMaxPlayers(Number.isInteger(n) ? n : null)
      })
      .catch(() => {
        if (alive) setMaxPlayers(null)
      })
    return () => {
      alive = false
    }
  }, [server.id])

  useEffect(() => {
    if (!contentLabel) return
    let alive = true
    setContent(null)
    setContentFailed(false)
    api
      .contentInstalled(server.id)
      .then((list) => {
        if (alive) setContent(list)
      })
      .catch(() => {
        if (alive) setContentFailed(true)
      })
    return () => {
      alive = false
    }
  }, [server.id, contentLabel])

  useEffect(() => {
    if (!running || runningSince === undefined) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running, runningSince])

  const uptime = running && runningSince !== undefined ? formatUptime(now - runningSince) : '—'
  const updates = content?.items.filter((i) => i.update).length ?? 0

  return (
    <div className="grid gap-4 min-[1000px]:grid-cols-2">
      <Card title="Status">
        <dl className="grid grid-cols-2 gap-4">
          <Stat label="State">{STATUS_LABEL[server.status]}</Stat>
          <Stat label="Uptime">{uptime}</Stat>
          <Stat label="Port">{server.port}</Stat>
          <Stat label="Sharing">{server.tunnel?.enabled ? 'Shared via playit' : 'Not shared'}</Stat>
        </dl>
      </Card>

      <Card
        title="Players"
        description={
          maxPlayers === null
            ? `${online.length} online`
            : `${online.length} / ${maxPlayers} online`
        }
        actions={<TextLink onClick={() => onSection('players')}>Manage players →</TextLink>}
      >
        {online.length === 0 ? (
          <p className="text-sm text-faint">No one online</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {online.slice(0, MAX_AVATARS).map((name) => (
              <li
                key={name}
                className="flex items-center gap-2 rounded-btn border border-border-soft bg-sidebar py-1 pl-1 pr-3"
              >
                <Avatar name={name} size={24} />
                <span className="text-sm text-text-2">{name}</span>
              </li>
            ))}
            {online.length > MAX_AVATARS && (
              <li className="self-center text-sm text-faint">
                +{online.length - MAX_AVATARS} more
              </li>
            )}
          </ul>
        )}
      </Card>

      <Card
        title="Console"
        className="min-[1000px]:col-span-2"
        actions={<TextLink onClick={() => onSection('console')}>Open console →</TextLink>}
      >
        <div className="rounded-btn border border-border-soft bg-console p-3 font-mono text-xs leading-5">
          {tail.length === 0 ? (
            <div className="text-faint">Server hasn&apos;t run yet</div>
          ) : (
            tail.map((text, i) => <LogLine key={i} text={text} {...parseLogLevel(text)} />)
          )}
        </div>
      </Card>

      {contentLabel && (
        <Card
          title={contentLabel}
          actions={
            <TextLink onClick={() => onSection('content')}>
              Manage {contentLabel.toLowerCase()} →
            </TextLink>
          }
        >
          {contentFailed ? (
            <p className="text-sm text-faint">
              Couldn&apos;t read the {contentLabel.toLowerCase()} folder.
            </p>
          ) : content === null ? (
            <p className="text-sm text-faint">Loading…</p>
          ) : (
            <dl className="grid grid-cols-2 gap-4">
              <Stat label="Installed">{content.items.length}</Stat>
              {!content.offline && <Stat label="Updates">{updates}</Stat>}
            </dl>
          )}
        </Card>
      )}

      <Card
        title="Connect"
        className={contentLabel ? '' : 'min-[1000px]:col-span-2'}
        actions={<TextLink onClick={() => onSection('connect')}>Connect settings →</TextLink>}
      >
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-btn border border-border-soft bg-sidebar px-3 py-2 font-mono text-sm text-text">
            {address}
          </code>
          <Button onClick={() => copy(address)}>
            <CopyIcon className="h-4 w-4" />
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

import type { ReactNode } from 'react'
import { SERVER_TYPE_LABELS, type ServerView } from '../../../shared/types'
import { STATUS_DOT } from '../lib/format'
import { sectionsFor, type Section } from '../lib/routes'
import { DiskUsagePanel } from './DiskUsagePanel'
import {
  ChevronDownIcon,
  ConnectIcon,
  ConsoleIcon,
  ContentIcon,
  Logo,
  OverviewIcon,
  PlayersIcon,
  PlusIcon,
  PropertiesIcon,
  ServersIcon,
  SettingsIcon
} from './icons'
import { Menu, type MenuEntry } from './ui'
import { UpdateBanner } from './UpdateBanner'

const SECTION_ICONS: Record<Section, ReactNode> = {
  overview: <OverviewIcon />,
  console: <ConsoleIcon />,
  players: <PlayersIcon />,
  content: <ContentIcon />,
  properties: <PropertiesIcon />,
  connect: <ConnectIcon />,
  settings: <SettingsIcon />
}

interface Props {
  servers: ServerView[]
  active: 'list' | 'new' | 'server'
  current?: ServerView
  section?: Section
  onlineCount: number
  version?: string
  offline: boolean
  onSection: (section: Section) => void
  onOpenServer: (id: string) => void
  onAllServers: () => void
  onNewServer: () => void
  children: ReactNode
}

function NavItem({
  icon,
  label,
  active,
  badge,
  onClick
}: {
  icon: ReactNode
  label: string
  active: boolean
  badge?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={`flex min-h-10 w-full items-center gap-3 rounded-btn px-3 text-sm font-medium transition-colors ${
        active
          ? 'bg-nav-active text-text ring-1 ring-inset ring-ring'
          : 'text-nav hover:bg-panel hover:text-text'
      }`}
    >
      <span className="h-[18px] w-[18px] shrink-0 [&>svg]:h-full [&>svg]:w-full">{icon}</span>
      <span className="hidden flex-1 truncate text-left min-[1000px]:inline">{label}</span>
      {badge !== undefined && (
        <span className="hidden rounded-sm bg-panel-2 px-1.5 font-mono text-[11px] text-text-2 min-[1000px]:inline">
          {badge}
        </span>
      )}
    </button>
  )
}

function ServerSwitcher({
  servers,
  current,
  onOpenServer,
  onAllServers,
  onNewServer
}: {
  servers: ServerView[]
  current: ServerView
  onOpenServer: (id: string) => void
  onAllServers: () => void
  onNewServer: () => void
}) {
  const items: MenuEntry[] = [
    ...servers.map((s): MenuEntry => ({
      label: s.name,
      hint: `${SERVER_TYPE_LABELS[s.type]} ${s.mcVersion}`,
      icon: <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s.status]}`} />,
      selected: s.id === current.id,
      onSelect: () => onOpenServer(s.id)
    })),
    'divider',
    { label: 'New server', icon: <PlusIcon />, onSelect: onNewServer },
    { label: 'All servers', icon: <ServersIcon />, onSelect: onAllServers }
  ]
  return (
    <Menu
      label={`Switch server (current: ${current.name})`}
      items={items}
      buttonClassName="flex h-11 w-full items-center gap-2.5 rounded-btn border border-border bg-panel px-3 text-left transition-colors hover:border-border-strong"
      button={
        <>
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[current.status]}`} />
          <span className="hidden min-w-0 flex-1 truncate text-sm font-medium text-text min-[1000px]:block">
            {current.name}
          </span>
          <ChevronDownIcon className="hidden h-4 w-4 shrink-0 text-muted min-[1000px]:block" />
        </>
      }
    />
  )
}

export function AppShell({
  servers,
  active,
  current,
  section,
  onlineCount,
  version,
  offline,
  onSection,
  onOpenServer,
  onAllServers,
  onNewServer,
  children
}: Props) {
  return (
    <div className="flex h-screen bg-bg text-text">
      <aside className="flex w-16 shrink-0 flex-col border-r border-border bg-sidebar min-[1000px]:w-[248px]">
        <button
          type="button"
          onClick={onAllServers}
          className="flex h-16 shrink-0 items-center gap-2.5 px-5"
          title="All servers"
        >
          <Logo className="h-6 w-6 shrink-0" />
          <span className="hidden text-[15px] font-bold tracking-tight min-[1000px]:inline">
            Blockhost
          </span>
        </button>

        {current && (
          <div className="px-3">
            <ServerSwitcher
              servers={servers}
              current={current}
              onOpenServer={onOpenServer}
              onAllServers={onAllServers}
              onNewServer={onNewServer}
            />
          </div>
        )}

        <nav
          aria-label="Sections"
          className="mt-3 flex flex-1 flex-col gap-0.5 overflow-y-auto px-3"
        >
          {current && section ? (
            sectionsFor(current.type).map((s) => (
              <NavItem
                key={s.id}
                icon={SECTION_ICONS[s.id]}
                label={s.label}
                active={section === s.id}
                badge={s.id === 'players' && onlineCount > 0 ? onlineCount : undefined}
                onClick={() => onSection(s.id)}
              />
            ))
          ) : (
            <>
              <NavItem
                icon={<ServersIcon />}
                label="All servers"
                active={active === 'list'}
                onClick={onAllServers}
              />
              <NavItem
                icon={<PlusIcon />}
                label="New server"
                active={active === 'new'}
                onClick={onNewServer}
              />
            </>
          )}
        </nav>

        <div className="hidden space-y-3 p-3 min-[1000px]:block">
          {current && <DiskUsagePanel serverId={current.id} diskLimitMb={current.diskLimitMb} />}
          <UpdateBanner />
          {version && (
            <div className="px-2 font-mono text-[11px] text-faint">Blockhost v{version}</div>
          )}
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {offline && (
          <div className="border-b border-warn-border bg-warn-bg px-8 py-1.5 text-[13px] text-warn">
            You seem to be offline. Version lists may be out of date.
          </div>
        )}
        <div className="px-8 pt-3 min-[1000px]:hidden">
          <UpdateBanner />
        </div>
        {children}
      </main>
    </div>
  )
}

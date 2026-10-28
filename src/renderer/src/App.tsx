import { useEffect, useRef, useState } from 'react'
import { AppShell } from './components/AppShell'
import { ErrorText, pageClass } from './components/ui'
import { useContentUpdates } from './hooks/useContentUpdates'
import { useOnlinePlayers } from './hooks/useOnlinePlayers'
import { useServers } from './hooks/useServers'
import { api } from './lib/api'
import { resolveSection, type Section } from './lib/routes'
import { NewServerWizard } from './pages/NewServerWizard'
import { ServerList } from './pages/ServerList'
import { ServerPage } from './pages/ServerPage'

type Route = { name: 'list' } | { name: 'new' } | { name: 'server'; id: string; section: Section }

export default function App() {
  const { servers, loaded, error, refresh } = useServers()
  const [route, setRoute] = useState<Route>({ name: 'list' })
  const [offline, setOffline] = useState(false)
  const lastSection = useRef(new Map<string, Section>())

  useEffect(() => api.on('net:offline', () => setOffline(true)), [])

  const current = route.name === 'server' ? servers.find((s) => s.id === route.id) : undefined
  const online = useOnlinePlayers(current?.id, current?.status)
  const contentUpdates = useContentUpdates(current?.id ?? null)

  const goList = () => setRoute({ name: 'list' })
  const goNew = () => setRoute({ name: 'new' })
  const openServer = (id: string) => {
    const server = servers.find((s) => s.id === id)
    const remembered = lastSection.current.get(id)
    const section = server ? resolveSection(server.type, remembered) : 'overview'
    setRoute({ name: 'server', id, section })
  }
  const setSection = (section: Section) => {
    if (route.name !== 'server') return
    lastSection.current.set(route.id, section)
    setRoute({ ...route, section })
  }

  return (
    <AppShell
      servers={servers}
      active={route.name}
      current={current}
      section={route.name === 'server' ? route.section : undefined}
      onlineCount={online.length}
      contentUpdates={contentUpdates}
      offline={offline}
      onSection={setSection}
      onOpenServer={openServer}
      onAllServers={goList}
      onNewServer={goNew}
    >
      {error && (
        <div className={`${pageClass} pb-0`}>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {route.name === 'list' && (
        <div className="min-h-0 flex-1 overflow-auto">
          <ServerList servers={servers} loaded={loaded} onOpen={openServer} onNew={goNew} />
        </div>
      )}
      {route.name === 'new' && (
        <div className="min-h-0 flex-1 overflow-auto">
          <NewServerWizard
            servers={servers}
            onCancel={goList}
            onCreated={() => void refresh()}
            onOpen={openServer}
          />
        </div>
      )}
      {route.name === 'server' &&
        (current ? (
          <ServerPage
            key={current.id}
            server={current}
            section={route.section}
            online={online}
            onChanged={() => void refresh()}
            onDeleted={() => {
              void refresh()
              goList()
            }}
          />
        ) : (
          <p className={`${pageClass} text-muted`}>This server no longer exists.</p>
        ))}
    </AppShell>
  )
}

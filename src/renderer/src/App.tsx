import { useEffect, useState } from 'react'
import { ErrorText } from './components/ui'
import { useServers } from './hooks/useServers'
import { api } from './lib/api'
import { ServerList } from './pages/ServerList'

type Route = { name: 'list' } | { name: 'new' } | { name: 'server'; id: string }

export default function App() {
  const { servers, loaded, error } = useServers()
  const [route, setRoute] = useState<Route>({ name: 'list' })
  const [offline, setOffline] = useState(false)

  useEffect(() => api.on('net:offline', () => setOffline(true)), [])

  const goList = () => setRoute({ name: 'list' })
  const openServer = (id: string) => setRoute({ name: 'server', id })
  const current = route.name === 'server' ? servers.find((s) => s.id === route.id) : undefined

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center gap-3 border-b border-zinc-800 px-6 py-3">
        <button type="button" onClick={goList} className="text-lg font-semibold tracking-tight">
          ⛏ Blockhost
        </button>
      </header>
      {offline && (
        <div className="border-b border-amber-900 bg-amber-950/60 px-6 py-2 text-sm text-amber-200">
          You seem to be offline. Version lists may be out of date.
        </div>
      )}
      {error && (
        <div className="px-6 pt-4">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      <main className="min-h-0 flex-1 overflow-auto">
        {route.name === 'list' && (
          <ServerList
            servers={servers}
            loaded={loaded}
            onOpen={openServer}
            onNew={() => setRoute({ name: 'new' })}
          />
        )}
        {route.name === 'new' && <p className="p-6 text-zinc-400">New server wizard</p>}
        {route.name === 'server' && <p className="p-6 text-zinc-400">{current?.name}</p>}
      </main>
    </div>
  )
}

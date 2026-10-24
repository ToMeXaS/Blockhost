import { useEffect, useState } from 'react'
import { CONTENT_LABELS, type ContentSource, type ServerView } from '../../../../shared/types'
import { Notice } from '../../components/ui'
import { api } from '../../lib/api'
import { BrowsePanel } from './content/BrowsePanel'
import { InstalledList } from './content/InstalledList'

export function ContentSection({ server }: { server: ServerView }) {
  const label = CONTENT_LABELS[server.type] ?? 'Mods'
  const noun = label === 'Plugins' ? 'plugins' : 'mods'
  const [available, setAvailable] = useState<{ source: ContentSource; label: string }[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [restartNeeded, setRestartNeeded] = useState(false)

  useEffect(() => {
    void api.contentSources(server.id).then(setAvailable, () => setAvailable([]))
  }, [server.id])
  useEffect(() => {
    if (server.status !== 'running') setRestartNeeded(false)
  }, [server.status])

  const installed = (restart: boolean) => {
    setRefreshKey((k) => k + 1)
    if (restart) setRestartNeeded(true)
  }

  return (
    <div className="space-y-4">
      {restartNeeded && server.status === 'running' && (
        <Notice tone="warn">Restart the server to apply changes.</Notice>
      )}
      <InstalledList server={server} noun={noun} refreshKey={refreshKey} onOpenProject={() => {}} />
      {available.length > 0 && (
        <BrowsePanel
          server={server}
          noun={noun}
          available={available}
          onOpen={() => {}}
          onInstalled={installed}
        />
      )}
    </div>
  )
}

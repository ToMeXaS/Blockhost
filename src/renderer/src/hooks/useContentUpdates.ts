import { useEffect, useState } from 'react'
import { api } from '../lib/api'

/** Updates available for the server's mods/plugins, as of its last installed-list refresh. */
export function useContentUpdates(serverId: string | null): number {
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(
    () =>
      api.on('content:updates', ({ serverId: id, count }) =>
        setCounts((c) => ({ ...c, [id]: count }))
      ),
    []
  )
  return serverId ? (counts[serverId] ?? 0) : 0
}

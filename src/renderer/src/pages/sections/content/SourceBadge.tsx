import { CONTENT_SOURCE_LABELS, type ContentSource } from '../../../../../shared/types'
import { Badge } from '../../../components/ui'

export function SourceBadge({ source }: { source: ContentSource | 'manual' }) {
  if (source === 'manual') return <Badge>added manually</Badge>
  return (
    <Badge tone={source === 'modrinth' ? 'accent' : 'neutral'}>
      {CONTENT_SOURCE_LABELS[source]}
    </Badge>
  )
}

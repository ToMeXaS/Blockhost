import type { ServerView } from '../../../../../shared/types'
import { Button } from '../../../components/ui'
import { useToast } from '../../../components/Toaster'

export function useSavedToast(server: ServerView): () => void {
  const toast = useToast()
  return () => {
    const stopped = server.status === 'stopped' || server.status === 'crashed'
    if (stopped) toast.success('Saved.')
    else toast.warn('Saved. Restart the server to apply the changes.')
  }
}

export function ConfigSaveBar({
  count,
  saving,
  onSave,
  onDiscard,
  blocked
}: {
  count: number
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  /** Reason saving is not possible right now (e.g. invalid YAML). */
  blocked?: string
}) {
  if (count === 0 && !saving) return null
  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-3 rounded-card border border-border bg-panel px-4 py-3 shadow-lg">
      <span className={`text-sm ${blocked ? 'text-danger' : 'text-muted'}`}>
        {blocked ?? `${count} unsaved ${count === 1 ? 'change' : 'changes'}`}
      </span>
      <div className="flex gap-2">
        <Button variant="ghost" disabled={saving} onClick={onDiscard}>
          Discard
        </Button>
        <Button variant="primary" disabled={saving || !!blocked} onClick={onSave}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}

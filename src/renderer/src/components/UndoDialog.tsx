import { useEffect, useState } from 'react'
import type { Release, UndoStep } from '../../../core/api'
import { api, friendlyError, type FriendlyError } from '../api'
import { ConfirmDialog } from './ConfirmDialog'
import { formatWhen, plural } from '../format'

interface Props {
  siteId: string
  release: Release
  /** Undo only these files; all if omitted. */
  paths?: string[]
  onCancel: () => void
  onDone: (r: Release) => void
}

function FileList({ items }: { items: string[] }) {
  return (
    <ul className="plain mono-list">
      {items.slice(0, 12).map((p) => (
        <li key={p} className="mono">
          {p}
        </li>
      ))}
      {items.length > 12 && <li className="muted">og {items.length - 12} til</li>}
    </ul>
  )
}

/** Confirmation with a concrete overview of what undoing will do on the server. */
export function UndoDialog({ siteId, release, paths, onCancel, onDone }: Props) {
  const [plan, setPlan] = useState<UndoStep[] | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)

  useEffect(() => {
    api.releases.planUndo(siteId, release.id, paths).then(setPlan, (e) => setError(friendlyError(e)))
  }, [siteId, release.id, paths])

  const restore = plan?.filter((s) => s.action === 'restore').map((s) => s.path) ?? []
  const remove = plan?.filter((s) => s.action === 'remove').map((s) => s.path) ?? []

  return (
    <ConfirmDialog
      title={paths ? `Angre ${plural(paths.length, 'fil', 'filer')} fra utgivelsen?` : 'Angre denne utgivelsen?'}
      confirmLabel="Angre"
      danger
      onCancel={onCancel}
      onConfirm={async () => {
        setError(null)
        try {
          onDone(await api.releases.undo(siteId, release.id, paths))
        } catch (e) {
          setError(friendlyError(e))
        }
      }}
    >
      <p className="muted">Utgivelsen {formatWhen(release.startedAt)}.</p>
      {!plan && !error && <p className="muted">Henter oversikt …</p>}
      {plan && (
        <>
          {restore.length > 0 && (
            <>
              <p>{plural(restore.length, 'fil får', 'filer får')} tilbake versjonen som lå på serveren før:</p>
              <FileList items={restore} />
            </>
          )}
          {remove.length > 0 && (
            <>
              <p>{plural(remove.length, 'fil var ny og blir fjernet', 'filer var nye og blir fjernet')} fra serveren:</p>
              <FileList items={remove} />
            </>
          )}
          <p className="muted">Filene på Macen blir ikke rørt. Endringene dukker opp i listen igjen, så du kan gi dem ut senere.</p>
        </>
      )}
      {error && (
        <div className="notice notice-error">
          {error.message}
          {error.hint && <div>{error.hint}</div>}
        </div>
      )}
    </ConfirmDialog>
  )
}

import { useEffect, useState } from 'react'
import type { Change, DiffResult } from '../../../core/api'
import { api, friendlyError, type FriendlyError } from '../api'
import { DiffBody } from './DiffBody'

interface Props {
  siteId: string
  change: Change
  onClose: () => void
  onCompare?: (path: string) => void
}

const KIND_LABEL = { added: 'Ny fil', modified: 'Endret', deleted: 'Slettet', renamed: 'Flyttet eller omdøpt' } as const

export function DiffView({ siteId, change, onClose, onCompare }: Props) {
  const [result, setResult] = useState<DiffResult | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [fetching, setFetching] = useState(false)

  const load = async (fromServer: boolean) => {
    setError(null)
    if (fromServer) setFetching(true)
    try {
      const r = await api.changes.diff(siteId, change, fromServer)
      setResult(r)
      // Images are never kept locally, so fetch the old one from the server right away.
      if (!fromServer && r.kind === 'image' && r.beforeMissing) void load(true)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setFetching(false)
    }
  }

  useEffect(() => {
    setResult(null)
    void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, change.path, change.kind, change.hash])

  return (
    <div className="diff">
      <div className="diff-head">
        <div className="diff-title">
          <span className="mono">{change.path}</span>
          <small className="muted">
            {KIND_LABEL[change.kind]}
            {change.kind === 'renamed' && change.from ? ` fra ${change.from}` : ''}
          </small>
        </div>
        <div className="toolbar">
          {onCompare && change.kind !== 'deleted' && /\.(html?|php|phtml|css|js|png|jpe?g|gif|webp|svg|avif)$/i.test(change.path) && (
            <button className="btn btn-small" onClick={() => onCompare(change.path)} title="Se den ekte siden og din versjon ved siden av hverandre">
              Før og etter
            </button>
          )}
          <button className="btn btn-small" onClick={onClose} aria-label="Lukk visningen">
            Lukk
          </button>
        </div>
      </div>

      {error && (
        <div className="notice notice-error">
          {error.message}
          {error.hint && <div>{error.hint}</div>}
        </div>
      )}
      {!result && !error && <div className="muted diff-pad">Henter …</div>}

      {result && (
        <DiffBody
          result={result}
          showBefore={change.kind !== 'added'}
          showAfter={change.kind !== 'deleted'}
          afterLabel={change.kind === 'added' ? 'Nytt bilde' : 'Etter'}
          fetching={fetching}
          onFetchOld={() => load(true)}
        />
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { FileHistoryEntry } from '../../../core/api'
import { api } from '../api'
import { formatWhen, plural } from '../format'
import { Modal } from './Modal'
import { DiffBody } from './DiffBody'

interface Props {
  siteId: string
  path: string
  onClose: () => void
}

const ACTION: Record<string, string> = { upload: 'Lastet opp', delete: 'Slettet', rename: 'Flyttet' }
const STATUS: Record<string, string> = { undone: 'angret', 'partly-undone': 'delvis angret', failed: 'feilet', partial: 'delvis' }

/** "Historikk for denne filen": every release that touched one file, with what changed each time. */
export function FileHistoryDialog({ siteId, path, onClose }: Props) {
  const [entries, setEntries] = useState<FileHistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    api.releases.fileHistory(siteId, path).then(
      (list) => {
        setEntries(list)
        setOpen(list[0]?.releaseId ?? null)
      },
      (e: Error) => setError(e.message)
    )
  }, [siteId, path])

  return (
    <Modal title="Historikk for denne filen" onClose={onClose} width={760}>
      <p className="mono file-history-path">{path}</p>
      {error && <div className="notice notice-error">{error}</div>}
      {!error && entries === null && <div className="muted">Henter …</div>}
      {entries?.length === 0 && <div className="muted">Ingen utgivelser har rørt denne filen.</div>}
      {entries && entries.length > 0 && (
        <p className="muted small-text">
          {plural(entries.length, 'utgivelse', 'utgivelser')} har rørt filen. Den nyeste står øverst.
        </p>
      )}
      <ul className="file-history-list">
        {entries?.map((e) => {
          const c = e.change
          const isOpen = open === e.releaseId
          const what = c.state !== 'done' ? 'Feilet' : c.undone ? 'Angret' : ACTION[c.action]
          return (
            <li key={e.releaseId} className="file-history-item">
              <button className="file-history-head" onClick={() => setOpen(isOpen ? null : e.releaseId)} aria-expanded={isOpen}>
                <span className="history-when">{formatWhen(e.at)}</span>
                <span className="muted">
                  {what}
                  {c.from && c.from !== path ? ` fra ${c.from}` : ''}
                  {c.from === path ? ` til ${c.path}` : ''}
                  {STATUS[e.status] ? ` (utgivelsen ${STATUS[e.status]})` : ''}
                </span>
                {c.diff && (
                  <span className="small-text">
                    <span className="diff-plus">+{c.added}</span> <span className="diff-minus">−{c.removed}</span>
                  </span>
                )}
                <span aria-hidden className="muted">
                  {isOpen ? '▴' : '▾'}
                </span>
              </button>
              {e.note && (
                <div className="file-history-note">
                  {e.note} {e.noteBy && <span className="ai-tag">Skrevet av AI</span>}
                </div>
              )}
              {isOpen && (
                <div className="file-history-body">
                  {c.diff ? (
                    <DiffBody result={{ kind: 'text', diff: c.diff, oldMissing: false, newMissing: false }} />
                  ) : (
                    <div className="muted diff-pad">{c.explanation ?? 'Ingen forskjell er lagret.'}</div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="form-actions">
        <button className="btn" onClick={onClose}>
          Lukk
        </button>
      </div>
    </Modal>
  )
}

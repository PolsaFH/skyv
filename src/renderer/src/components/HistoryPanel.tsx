import { useEffect, useState } from 'react'
import type { Release } from '../../../core/api'
import { api } from '../api'
import { formatWhen, plural } from '../format'
import { PostCheckView } from './PostCheckView'
import { FileHistoryDialog } from './FileHistoryDialog'

interface Props {
  siteId: string
  /** Changes whenever a release or undo finished, to reload the list. */
  refreshToken: number
  onUndo: (release: Release, paths?: string[]) => void
  busy: boolean
}

const STATUS: Record<Release['status'], { label: string; cls: string }> = {
  'in-progress': { label: 'Pågår', cls: 'st-info' },
  success: { label: 'Vellykket', cls: 'st-ok' },
  partial: { label: 'Delvis', cls: 'st-warn' },
  failed: { label: 'Feilet', cls: 'st-err' },
  undone: { label: 'Angret', cls: 'st-muted' },
  'partly-undone': { label: 'Delvis angret', cls: 'st-muted' }
}

const ACTION: Record<string, string> = { upload: 'lastet opp', delete: 'slettet', rename: 'flyttet' }

/** Pull-out list of earlier releases with undo for the whole release or chosen files. */
export function HistoryPanel({ siteId, refreshToken, onUndo, busy }: Props) {
  const [open, setOpen] = useState(false)
  const [releases, setReleases] = useState<Release[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null)

  const saveNote = async () => {
    if (!editing) return
    const updated = await api.releases.setNote(siteId, editing.id, editing.text)
    setReleases((list) => list?.map((r) => (r.id === updated.id ? updated : r)) ?? null)
    setEditing(null)
  }

  useEffect(() => {
    if (!open) return
    api.releases.list(siteId).then(setReleases, () => setReleases([]))
  }, [open, siteId, refreshToken])

  useEffect(() => setChosen(new Set()), [expanded])

  return (
    <section className={`history ${open ? 'open' : ''}`}>
      <button className="history-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        Tidligere utgivelser <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="history-body">
          {releases === null && <div className="muted">Henter …</div>}
          {releases?.length === 0 && <div className="muted">Ingen utgivelser ennå.</div>}
          <ul className="history-list">
            {releases?.map((r) => {
              const done = r.items.filter((i) => i.state === 'done')
              const undoable = r.snapshot === 'kept' && done.some((i) => !i.undone)
              const isOpen = expanded === r.id
              return (
                <li key={r.id} className="history-item">
                  <div className="history-row">
                    <button className="history-main" onClick={() => setExpanded(isOpen ? null : r.id)} aria-expanded={isOpen}>
                      <span className="history-when">{formatWhen(r.startedAt)}</span>
                      <span className="muted">{plural(r.items.length, 'fil', 'filer')}</span>
                      {r.note && <span className="history-note">{r.note}</span>}
                    </button>
                    {r.check && !r.check.skipped && (
                      <span className={`status-pill ${r.check.ok ? 'st-ok' : 'st-err'}`} title="Sjekk etter opplasting">
                        {r.check.ok ? 'Siden OK' : r.check.autoUndone ? 'Feil, angret' : 'Feil på siden'}
                      </span>
                    )}
                    <span className={`status-pill ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                    {undoable && (
                      <button className="btn btn-small" disabled={busy} onClick={() => onUndo(r)}>
                        Angre
                      </button>
                    )}
                  </div>
                  {isOpen && (
                    <div className="history-files">
                      {editing?.id === r.id ? (
                        <div className="note-edit">
                          <textarea rows={2} value={editing.text} onChange={(e) => setEditing({ id: r.id, text: e.target.value })} aria-label="Notat" autoFocus />
                          <div className="choice-buttons">
                            <button className="btn btn-small btn-primary" onClick={() => void saveNote()}>
                              Lagre notat
                            </button>
                            <button className="btn btn-small" onClick={() => setEditing(null)}>
                              Avbryt
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="note-view">
                          <span className={r.note ? '' : 'muted'}>{r.note ?? 'Ingen notat.'}</span>{' '}
                          {r.note && r.noteBy && <span className="ai-tag">Skrevet av AI</span>}{' '}
                          <button className="link-btn small-text" onClick={() => setEditing({ id: r.id, text: r.note ?? '' })}>
                            {r.note ? 'Rediger' : 'Skriv notat'}
                          </button>
                        </div>
                      )}
                      {r.check && <PostCheckView check={r.check} />}
                      {r.snapshot === 'pruned' && (
                        <div className="muted small-text">Sikkerhetskopien er fjernet fordi utgivelsen er blant de eldste, så den kan ikke angres.</div>
                      )}
                      <ul className="plain-list">
                        {r.items.map((i) => {
                          const canPick = undoable && i.state === 'done' && !i.undone
                          return (
                            <li key={i.path} className={i.undone ? 'muted' : ''}>
                              {canPick && (
                                <input
                                  type="checkbox"
                                  checked={chosen.has(i.path)}
                                  aria-label={`Velg ${i.path}`}
                                  onChange={(e) => {
                                    const next = new Set(chosen)
                                    if (e.target.checked) next.add(i.path)
                                    else next.delete(i.path)
                                    setChosen(next)
                                  }}
                                />
                              )}
                              <button className="link-btn mono" title="Historikk for denne filen" onClick={() => setHistoryFor(i.path)}>
                                {i.path}
                              </button>
                              <span className="muted">
                                {' '}
                                {i.state === 'failed' ? 'feilet' : i.undone ? 'angret' : ACTION[i.action]}
                                {i.from ? ` fra ${i.from}` : ''}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                      {chosen.size > 0 && (
                        <button className="btn btn-small" disabled={busy} onClick={() => onUndo(r, [...chosen])}>
                          Angre {plural(chosen.size, 'valgt fil', 'valgte filer')}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {historyFor && <FileHistoryDialog siteId={siteId} path={historyFor} onClose={() => setHistoryFor(null)} />}
    </section>
  )
}

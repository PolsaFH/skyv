import type { Draft, Release, UndoRequest } from '../../../core/api'
import { formatWhen, plural } from '../format'

interface Props {
  draft: Draft | null
  undoRequest: UndoRequest | null
  undoRelease: Release | null
  /** Problems found when trying to give the draft out (shown in the band). */
  problems: string[] | null
  busy: boolean
  reviewing: boolean
  onReview: () => void
  onRelease: () => void
  onDiscard: () => void
  onUndoReview: () => void
  onUndoReject: () => void
}

function findingsText(f: Draft['findings']): { text: string; cls: string } {
  if (f.blocking > 0) return { text: plural(f.blocking, 'alvorlig funn', 'alvorlige funn'), cls: 'danger-text' }
  if (f.warnings > 0) return { text: plural(f.warnings, 'advarsel', 'advarsler'), cls: 'warn-inline' }
  return { text: 'ingen advarsler', cls: 'ok-inline' }
}

/** Bands at the top of a site: a release prepared by AI, and a request from AI to undo a release. */
export function DraftBand({ draft, undoRequest, undoRelease, problems, busy, reviewing, onReview, onRelease, onDiscard, onUndoReview, onUndoReject }: Props) {
  return (
    <>
      {undoRequest && (
        <div className="band band-undo" role="alert">
          <div className="band-text">
            <strong>
              {undoRequest.requestedBy} ber deg angre utgivelsen{undoRelease ? ` fra ${formatWhen(undoRelease.startedAt)}` : ''}.
            </strong>
            <div className="band-quote">
              Begrunnelse fra AI: «{undoRequest.reason}»
            </div>
          </div>
          <div className="band-actions">
            <button className="btn btn-small btn-primary" onClick={onUndoReview} disabled={busy || !undoRelease}>
              Se gjennom og angre …
            </button>
            <button className="btn btn-small" onClick={onUndoReject} disabled={busy}>
              Avvis
            </button>
          </div>
        </div>
      )}
      {draft && (
        <div className="band band-draft" role="status">
          <div className="band-text">
            <strong>
              {draft.createdBy} har klargjort en utgivelse: {plural(draft.files.length, 'fil', 'filer')},{' '}
              <span className={findingsText(draft.findings).cls}>{findingsText(draft.findings).text}</span>
            </strong>
            <div className="band-note">
              {draft.note} <span className="ai-tag">Skrevet av AI</span>
            </div>
            {problems && problems.length > 0 && (
              <ul className="plain band-problems">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="band-actions">
            <button className="btn btn-small" onClick={onReview} disabled={busy || reviewing}>
              {reviewing ? 'Ser gjennom' : 'Se gjennom'}
            </button>
            <button className="btn btn-small btn-primary" onClick={onRelease} disabled={busy}>
              Gi ut
            </button>
            <button className="btn btn-small btn-danger-ghost" onClick={onDiscard} disabled={busy}>
              Forkast
            </button>
          </div>
        </div>
      )}
    </>
  )
}

import type { DiffResult } from '../../../core/api'
import { formatBytes } from '../format'

interface Props {
  result: DiffResult
  showBefore?: boolean
  showAfter?: boolean
  beforeLabel?: string
  afterLabel?: string
  fetching?: boolean
  onFetchOld?: () => void
  /** Text shown when the old version is not available locally. */
  missingOldText?: string
}

/** Renders a text diff (line by line) or images before/after. */
export function DiffBody({ result, showBefore = true, showAfter = true, beforeLabel = 'Før', afterLabel = 'Etter', fetching, onFetchOld, missingOldText }: Props) {
  return (
    <>
      {result.kind === 'text' && (
        <>
          {result.oldMissing && onFetchOld && (
            <div className="notice notice-info diff-notice">
              {missingOldText ?? 'Skyv har ikke en kopi av forrige versjon av denne filen.'}
              <div>
                <button className="btn btn-small" onClick={onFetchOld} disabled={fetching}>
                  {fetching ? 'Henter …' : 'Hent forrige versjon fra serveren'}
                </button>
              </div>
            </div>
          )}
          {result.diff.identical && !result.oldMissing ? (
            <div className="muted diff-pad">Innholdet er likt. Bare navnet eller plasseringen er endret.</div>
          ) : (
            <div className="diff-summary muted">
              <span className="diff-plus">+{result.diff.added}</span> <span className="diff-minus">−{result.diff.removed}</span> linjer
            </div>
          )}
          <div className="diff-table" role="table" aria-label="Forskjeller linje for linje">
            {result.diff.rows.map((r, i) =>
              r.kind === 'gap' ? (
                <div key={i} className="diff-row diff-gap" role="row">
                  <span className="diff-gap-text">{r.hidden} like linjer</span>
                </div>
              ) : (
                <div key={i} className={`diff-row diff-${r.kind}`} role="row">
                  <span className="diff-no">{r.oldNo ?? ''}</span>
                  <span className="diff-no">{r.newNo ?? ''}</span>
                  <span className="diff-sign" aria-hidden>
                    {r.kind === 'added' ? '+' : r.kind === 'removed' ? '−' : ' '}
                  </span>
                  <span className="diff-text">{r.text || ' '}</span>
                </div>
              )
            )}
          </div>
        </>
      )}

      {result.kind === 'image' && (
        <div className="image-compare">
          {showBefore && (
            <figure>
              <figcaption>{beforeLabel}</figcaption>
              {result.before ? (
                <img src={result.before} alt="Forrige versjon" />
              ) : (
                <div className="image-missing muted">{fetching ? 'Henter fra serveren …' : 'Forrige versjon er ikke tilgjengelig.'}</div>
              )}
            </figure>
          )}
          {showAfter && (
            <figure>
              <figcaption>{afterLabel}</figcaption>
              {result.after ? <img src={result.after} alt="Ny versjon" /> : <div className="image-missing muted">Finnes ikke.</div>}
            </figure>
          )}
        </div>
      )}

      {result.kind === 'binary' && <div className="muted diff-pad">Dette er ikke en tekstfil ({formatBytes(result.size)}), så forskjellen kan ikke vises.</div>}
      {result.kind === 'too-large' && <div className="muted diff-pad">Filen er for stor til å vise forskjeller ({formatBytes(result.size)}).</div>}
    </>
  )
}

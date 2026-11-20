import type { Release } from '../../../core/api'
import { plural } from '../format'

type Check = NonNullable<Release['check']>

interface Props {
  check: Check
  /** One-click undo of the whole release (shown when the check failed). */
  onUndo?: () => void
  onRecheck?: () => void
  busy?: boolean
}

function pathOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname)
  } catch {
    return url
  }
}

/** Result of "sjekk etter opplasting". */
export function PostCheckView({ check, onUndo, onRecheck, busy }: Props) {
  if (check.skipped) {
    return (
      <div className="postcheck postcheck-skip muted">
        {check.skipped}
        {check.skipped.includes('Nettadressen') && ' Legg den inn i innstillingene for å få sjekk etter hver utgivelse.'}
      </div>
    )
  }
  const badPages = check.pages.filter((p) => !p.ok)
  const badAssets = check.assets.filter((a) => !a.ok)

  if (check.ok) {
    return (
      <div className="postcheck postcheck-ok">
        <strong>✓ Nettsiden svarer som den skal.</strong>{' '}
        <span className="muted">
          {plural(check.pages.length, 'side', 'sider')} og {plural(check.assets.length, 'fil', 'filer')} sjekket.
        </span>
        {onRecheck && (
          <button className="link-btn small-text" onClick={onRecheck} disabled={busy}>
            Sjekk igjen
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="postcheck postcheck-bad" role="alert">
      <strong className="postcheck-title">{check.autoUndone ? 'Noe så feil ut, så Skyv angret utgivelsen' : 'Noe ser feil ut på siden din'}</strong>
      {check.autoUndone && <div>Den forrige versjonen ligger ute igjen. Endringene står i listen, så du kan rette feilen og prøve på nytt.</div>}
      <ul className="plain">
        {badPages.map((p) => (
          <li key={p.url}>
            <a href={p.url} target="_blank" rel="noreferrer" className="mono">
              {pathOf(p.url) === '/' ? 'Forsiden' : pathOf(p.url)}
            </a>
            {p.via && <span className="muted"> (bruker {p.via})</span>}: {p.problems.join(' ')}
          </li>
        ))}
        {badAssets.slice(0, 10).map((a) => (
          <li key={a.url}>
            <span className="mono">{pathOf(a.url)}</span> <span className="muted">(brukes av {a.usedBy})</span>: {a.problem}
          </li>
        ))}
        {badAssets.length > 10 && <li className="muted">og {badAssets.length - 10} filer til</li>}
      </ul>
      <div className="choice-buttons">
        {onUndo && !check.autoUndone && (
          <button className="btn btn-danger" onClick={onUndo} disabled={busy}>
            Angre utgivelsen
          </button>
        )}
        {onRecheck && (
          <button className="btn" onClick={onRecheck} disabled={busy}>
            Sjekk igjen
          </button>
        )}
      </div>
    </div>
  )
}

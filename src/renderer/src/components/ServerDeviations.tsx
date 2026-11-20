import { useEffect, useState } from 'react'
import type { Deviation, DeviationAction, DiffResult, ServerCheckResult } from '../../../core/api'
import { api, friendlyError, type FriendlyError } from '../api'
import { formatAgo, formatBytes, plural } from '../format'
import { ConfirmDialog } from './ConfirmDialog'
import { Modal } from './Modal'
import { DiffBody } from './DiffBody'

interface Props {
  siteId: string
  result: ServerCheckResult | null
  checking: boolean
  error: FriendlyError | null
  onCheck: () => void
  /** "Last opp på nytt" gives out a file; the parent shows the release progress. */
  onReupload: (path: string) => void
  onResolved: (result: ServerCheckResult | undefined, message: string) => void
  busy: boolean
}

const GROUPS: Array<{ kind: Deviation['kind']; title: string; explain: string }> = [
  { kind: 'missing', title: 'Mangler på serveren', explain: 'Skyv har gitt ut disse filene, men de finnes ikke på serveren lenger. Noen kan ha slettet dem, for eksempel i FileZilla.' },
  { kind: 'changed', title: 'Endret på serveren', explain: 'Disse filene er endret på serveren siden Skyv sist ga dem ut.' },
  { kind: 'server-only', title: 'Bare på serveren', explain: 'Disse filene ligger på serveren, men ikke i mappen på Macen. Skyv rører dem aldri av seg selv.' }
]

type Confirm = { deviation: Deviation; action: DeviationAction }

/** "Avvik på serveren": what the server check found, with one set of choices per file. */
export function ServerDeviations({ siteId, result, checking, error, onCheck, onReupload, onResolved, busy }: Props) {
  const [working, setWorking] = useState<string | null>(null)
  const [actionError, setActionError] = useState<FriendlyError | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [diff, setDiff] = useState<{ path: string; result?: DiffResult; error?: FriendlyError } | null>(null)
  const [open, setOpen] = useState(true)
  const [, tick] = useState(0)

  // Keep "Sjekket for N minutter siden" fresh.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const act = async (d: Deviation, action: DeviationAction) => {
    if (action === 'reupload') return onReupload(d.path)
    setWorking(d.path)
    setActionError(null)
    try {
      const r = await api.serverCheck.resolve(siteId, d.path, action)
      onResolved(r.result, r.message)
    } catch (e) {
      setActionError(friendlyError(e))
    } finally {
      setWorking(null)
    }
  }

  const showDiff = async (path: string) => {
    setDiff({ path })
    try {
      setDiff({ path, result: await api.releases.conflictDiff(siteId, path) })
    } catch (e) {
      setDiff({ path, error: friendlyError(e) })
    }
  }

  const deviations = result?.deviations ?? []
  const when = result ? `Sjekket ${formatAgo(result.checkedAt)}` : 'Serveren er ikke sjekket ennå'

  const header = (
    <div className="dev-head">
      <div className="dev-status">
        {deviations.length > 0 ? (
          <button className="dev-title" onClick={() => setOpen(!open)} aria-expanded={open}>
            <span aria-hidden>⚠</span> Avvik på serveren <span className="finding-count">{deviations.length}</span>
          </button>
        ) : result ? (
          <span className="dev-ok">✓ Serveren stemmer med Skyv</span>
        ) : (
          <span className="muted">Serveren er ikke sjekket</span>
        )}
        <small className="muted">{checking ? 'Sjekker serveren …' : when}</small>
      </div>
      <button className="btn btn-small" onClick={onCheck} disabled={checking || busy}>
        {checking ? 'Sjekker …' : 'Sjekk serveren'}
      </button>
    </div>
  )

  return (
    <section className={`deviations ${deviations.length > 0 ? 'has-deviations' : ''}`} aria-label="Avvik på serveren">
      {header}
      {error && (
        <div className="notice notice-error small-text">
          {error.message}
          {error.hint && <div>{error.hint}</div>}
        </div>
      )}
      {result && !result.reliableTimes && deviations.length > 0 && open && (
        <div className="muted small-text">
          Denne serveren oppgir ikke nøyaktig når filer ble endret. Slettede filer oppdages, men en fil som er endret uten at størrelsen endret seg, kan
          ikke oppdages.
        </div>
      )}
      {result && result.unlistedFolders.length > 0 && open && (
        <div className="muted small-text">
          {plural(result.unlistedFolders.length, 'mappe', 'mapper')} på serveren kunne ikke leses ({result.unlistedFolders.slice(0, 3).join(', ')}), så filer der
          er ikke sjekket.
        </div>
      )}
      {actionError && (
        <div className="notice notice-error small-text">
          {actionError.message}
          {actionError.hint && <div>{actionError.hint}</div>}
        </div>
      )}

      {open &&
        GROUPS.map((g) => {
          const items = deviations.filter((d) => d.kind === g.kind)
          if (items.length === 0) return null
          return (
            <div key={g.kind} className={`dev-group dev-${g.kind}`}>
              <div className="dev-group-head">
                <strong>{g.title}</strong> <span className="muted">({items.length})</span>
                <div className="muted small-text">{g.explain}</div>
              </div>
              <ul className="dev-list">
                {items.slice(0, 50).map((d) => (
                  <li key={d.path} className="dev-item">
                    <div className="dev-file">
                      <span className="mono">{d.path}</span>
                      {d.kind !== 'missing' && d.remoteSize !== undefined && <small className="muted"> {formatBytes(d.remoteSize)} på serveren</small>}
                      {d.usedBy.length > 0 && d.kind !== 'server-only' && (
                        <div className="dev-used">
                          Siden din bruker denne filen ({d.usedBy.slice(0, 3).join(', ')}{d.usedBy.length > 3 ? ' …' : ''}),{' '}
                          {d.kind === 'missing' ? 'og den mangler på serveren.' : 'og den er endret på serveren.'}
                        </div>
                      )}
                      {d.kind === 'missing' && !d.existsLocally && <div className="muted small-text">Filen finnes ikke på Macen heller.</div>}
                    </div>
                    <div className="dev-actions">
                      {working === d.path ? (
                        <span className="muted small-text">Arbeider …</span>
                      ) : d.kind === 'missing' ? (
                        <>
                          {d.existsLocally && (
                            <button className="btn btn-small btn-primary" disabled={busy} onClick={() => act(d, 'reupload')}>
                              Last opp på nytt
                            </button>
                          )}
                          {d.existsLocally && (
                            <button className="btn btn-small" disabled={busy} onClick={() => setConfirm({ deviation: d, action: 'delete-local' })}>
                              Slett den på Macen også …
                            </button>
                          )}
                          <button className="btn btn-small" disabled={busy} onClick={() => act(d, 'let-go')}>
                            La den være borte
                          </button>
                        </>
                      ) : d.kind === 'changed' ? (
                        <>
                          <button className="btn btn-small" onClick={() => showDiff(d.path)}>
                            Vis forskjell
                          </button>
                          <button className="btn btn-small" disabled={busy} onClick={() => setConfirm({ deviation: d, action: 'fetch-server' })}>
                            Hent serverens versjon til Macen …
                          </button>
                          {d.existsLocally && (
                            <button className="btn btn-small" disabled={busy} onClick={() => act(d, 'overwrite-mine')}>
                              Overskriv med min versjon
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <button className="btn btn-small" disabled={busy} onClick={() => act(d, 'fetch-to-mac')}>
                            Hent til Macen
                          </button>
                          <button className="btn btn-small" disabled={busy} onClick={() => act(d, 'dismiss')}>
                            La være
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
                {items.length > 50 && <li className="muted small-text">og {items.length - 50} til</li>}
              </ul>
            </div>
          )
        })}

      {confirm && (
        <ConfirmDialog
          title={confirm.action === 'delete-local' ? 'Slette filen på Macen også?' : 'Hente serverens versjon til Macen?'}
          confirmLabel={confirm.action === 'delete-local' ? 'Flytt til Papirkurven' : 'Hent serverens versjon'}
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const c = confirm
            setConfirm(null)
            await act(c.deviation, c.action)
          }}
        >
          <p className="mono">{confirm.deviation.path}</p>
          {confirm.action === 'delete-local' ? (
            <p>Filen finnes ikke på serveren lenger. Den blir flyttet til Papirkurven på Macen, så du kan hente den tilbake derfra.</p>
          ) : (
            <p>Versjonen på Macen blir flyttet til Papirkurven, og serverens versjon blir lagt i mappen i stedet. Du kan hente Macens versjon tilbake fra Papirkurven.</p>
          )}
        </ConfirmDialog>
      )}

      {diff && (
        <Modal title={`Forskjell: ${diff.path}`} onClose={() => setDiff(null)} width={720}>
          {!diff.result && !diff.error && <div className="muted">Henter serverens versjon …</div>}
          {diff.error && <div className="notice notice-error">{diff.error.message}</div>}
          {diff.result && (
            <div className="dev-diff">
              <DiffBody result={diff.result} beforeLabel="På serveren nå" afterLabel="På Macen" missingOldText="Fant ikke filen på serveren." />
            </div>
          )}
          <div className="form-actions">
            <button className="btn btn-primary" onClick={() => setDiff(null)}>
              Lukk
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}


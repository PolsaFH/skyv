import { useCallback, useEffect, useState } from 'react'
import type { SiteView } from '../../core/types'
import type { QuickReleaseResult } from '../../core/api'
import { api, friendlyError } from './api'
import { plural } from './format'

type SiteState = { busy?: boolean; result?: QuickReleaseResult; error?: string }

/** The small window under the menu bar icon: all sites, pending changes and "Gi ut". */
export function TrayApp() {
  const [sites, setSites] = useState<SiteView[]>([])
  const [state, setState] = useState<Record<string, SiteState>>({})
  const [drafts, setDrafts] = useState<Record<string, number>>({})

  const load = useCallback(() => {
    api.sites.list().then(async (list) => {
      setSites(list)
      const counts: Record<string, number> = {}
      for (const s of list) counts[s.id] = (await api.drafts.list(s.id).catch(() => ({ drafts: [] }))).drafts.length
      setDrafts(counts)
    }, () => undefined)
  }, [])

  useEffect(() => {
    load()
    const off = api.app.onChangesUpdated(() => load())
    const off2 = api.serverCheck.onUpdated(() => load())
    const off3 = api.drafts.onUpdated(() => load())
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      off2()
      off3()
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const release = async (site: SiteView, acceptWarnings = false) => {
    setState((s) => ({ ...s, [site.id]: { busy: true } }))
    try {
      const result = await api.app.quickRelease(site.id, acceptWarnings)
      setState((s) => ({ ...s, [site.id]: { result } }))
    } catch (e) {
      setState((s) => ({ ...s, [site.id]: { error: friendlyError(e).message } }))
    } finally {
      load()
    }
  }

  const total = sites.reduce((n, s) => n + s.pendingCount, 0)

  return (
    <div className="tray">
      <header className="tray-head">
        <strong>Skyv</strong>
        <span className="muted">{total === 0 ? 'Alt er gitt ut' : `${plural(total, 'endring venter', 'endringer venter')}`}</span>
      </header>
      <ul className="tray-list">
        {sites.length === 0 && <li className="muted tray-empty">Ingen nettsider ennå. Åpne Skyv for å legge til en.</li>}
        {sites.map((site) => {
          const st = state[site.id] ?? {}
          const r = st.result
          return (
            <li key={site.id} className="tray-site">
              <div className="tray-row">
                <span className={`dot ${site.pendingCount > 0 ? 'dot-pending' : 'dot-ok'}`} />
                <button className="tray-name" onClick={() => api.app.openMain(site.id)} title="Åpne i Skyv">
                  {site.name}
                </button>
                {drafts[site.id] > 0 && (
                  <button className="draft-marker" onClick={() => api.app.openMain(site.id)} title="AI har klargjort en utgivelse">
                    Utkast
                  </button>
                )}
                {site.deviationCount > 0 && (
                  <span className="dev-marker" title={`${site.deviationCount} avvik på serveren`}>
                    ⚠ {site.deviationCount}
                  </span>
                )}
                {site.pendingCount > 0 && <span className="badge">{site.pendingCount}</span>}
                <button className="btn btn-small btn-primary" disabled={site.pendingCount === 0 || st.busy} onClick={() => release(site)}>
                  {st.busy ? 'Gir ut …' : 'Gi ut'}
                </button>
              </div>
              {r?.status === 'released' && (
                <div className={`tray-msg ${r.release.check && !r.release.check.ok && !r.release.check.skipped ? 'tray-bad' : 'tray-ok'}`}>
                  {r.release.check && !r.release.check.ok && !r.release.check.skipped ? (
                    <>
                      {r.release.check.autoUndone ? 'Noe så feil ut, så Skyv angret utgivelsen.' : 'Utgitt, men noe ser feil ut på siden.'}{' '}
                      <button className="link-btn" onClick={() => api.app.openMain(site.id)}>
                        Se hva
                      </button>
                    </>
                  ) : r.release.status === 'success' ? (
                    '✓ Utgitt.'
                  ) : (
                    <>
                      Noen filer kom ikke ut.{' '}
                      <button className="link-btn" onClick={() => api.app.openMain(site.id)}>
                        Se hvilke
                      </button>
                    </>
                  )}
                </div>
              )}
              {r?.status === 'warnings' && (
                <div className="tray-msg tray-warn">
                  {plural(r.count, 'advarsel', 'advarsler')}: {r.examples[0]}
                  <div className="tray-actions">
                    <button className="btn btn-small" onClick={() => api.app.openMain(site.id)}>
                      Se gjennom
                    </button>
                    <button className="btn btn-small" onClick={() => release(site, true)}>
                      Gi ut likevel
                    </button>
                  </div>
                </div>
              )}
              {r?.status === 'needs-review' && (
                <div className="tray-msg tray-warn">
                  {r.message}{' '}
                  <button className="link-btn" onClick={() => api.app.openMain(site.id)}>
                    Åpne
                  </button>
                </div>
              )}
              {st.error && <div className="tray-msg tray-bad">{st.error}</div>}
            </li>
          )
        })}
      </ul>
      <footer className="tray-foot">
        <button className="btn btn-small" onClick={() => api.app.openMain()}>
          Åpne Skyv
        </button>
      </footer>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import type { RemoteEntry } from '../../../core/remote/types'
import type { RootCandidate } from '../../../core/remote/detectRoot'
import { api, friendlyError, type FriendlyError } from '../api'

interface Props {
  sessionId: string
  homeDir: string
  localPath: string
  siteName: string
  value: string
  onChange: (path: string) => void
}

function parent(path: string): string {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return '/' + parts.join('/')
}

function join(dir: string, name: string): string {
  return (dir === '/' ? '' : dir) + '/' + name
}

/** Suggests the web root on the server and lets the user browse to pick another folder. */
export function RemoteFolderPicker({ sessionId, homeDir, localPath, siteName, value, onChange }: Props) {
  const [candidates, setCandidates] = useState<RootCandidate[] | null>(null)
  const [detectError, setDetectError] = useState<FriendlyError | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [browseDir, setBrowseDir] = useState(value || homeDir)
  const [entries, setEntries] = useState<RemoteEntry[] | null>(null)
  const [browseError, setBrowseError] = useState<FriendlyError | null>(null)

  useEffect(() => {
    let cancelled = false
    api.remote
      .detectRoot(sessionId, localPath, siteName)
      .then((res) => {
        if (cancelled) return
        setCandidates(res)
        if (!value && res[0]) onChange(res[0].path)
      })
      .catch((e) => !cancelled && setDetectError(friendlyError(e)))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, localPath, siteName])

  const loadDir = useCallback(
    async (dir: string) => {
      setBrowseDir(dir)
      setEntries(null)
      setBrowseError(null)
      try {
        setEntries(await api.remote.list(sessionId, dir))
      } catch (e) {
        setBrowseError(friendlyError(e))
      }
    },
    [sessionId]
  )

  useEffect(() => {
    if (browsing) void loadDir(browseDir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsing])

  const top = candidates ? candidates.filter((c, i) => i === 0 || c.score > 0.2).slice(0, 4) : []
  const best = candidates?.[0]
  const confident = best && best.score >= 0.5

  return (
    <div className="form">
      {candidates === null && !detectError && <div className="muted">Ser etter riktig mappe på serveren …</div>}
      {detectError && (
        <div className="notice notice-error">
          {detectError.message}
          {detectError.hint && <div>{detectError.hint}</div>}
        </div>
      )}
      {candidates && (
        <>
          <p className="lead">
            {confident
              ? 'Skyv fant en mappe på serveren som ser ut til å høre til denne nettsiden. Stemmer det?'
              : 'Skyv fant ingen mappe som ligner tydelig på den på Macen. Velg den som passer best, eller bla gjennom serveren.'}
          </p>
          <div className="choice-list" role="radiogroup" aria-label="Mappe på serveren">
            {top.map((c) => (
              <label key={c.path} className={`choice ${value === c.path ? 'chosen' : ''}`}>
                <input type="radio" name="remote-root" checked={value === c.path} onChange={() => onChange(c.path)} />
                <span>
                  <span className="mono">{c.path}</span>
                  <small className="muted">{c.reason}</small>
                </span>
              </label>
            ))}
            {value && !top.some((c) => c.path === value) && (
              <label className="choice chosen">
                <input type="radio" name="remote-root" checked readOnly />
                <span>
                  <span className="mono">{value}</span>
                  <small className="muted">Valgt av deg.</small>
                </span>
              </label>
            )}
          </div>
        </>
      )}

      {!browsing ? (
        <div>
          <button type="button" className="btn" onClick={() => setBrowsing(true)}>
            Bla gjennom serveren …
          </button>
        </div>
      ) : (
        <div className="browser">
          <div className="browser-bar">
            <button type="button" className="btn btn-small" onClick={() => loadDir(parent(browseDir))} disabled={browseDir === '/'} aria-label="Opp en mappe">
              ↑
            </button>
            <span className="mono grow">{browseDir}</span>
            <button type="button" className="btn btn-small btn-primary" onClick={() => onChange(browseDir)}>
              Bruk denne mappen
            </button>
          </div>
          <ul className="browser-list">
            {entries === null && !browseError && <li className="muted">Henter …</li>}
            {browseError && <li className="error-text">{browseError.message}</li>}
            {entries?.length === 0 && <li className="muted">Mappen er tom.</li>}
            {entries?.map((e) =>
              e.type === 'dir' || e.type === 'link' ? (
                <li key={e.name}>
                  <button type="button" className="browser-item" onDoubleClick={() => loadDir(join(browseDir, e.name))} onClick={() => loadDir(join(browseDir, e.name))}>
                    <span aria-hidden>📁</span> {e.name}
                  </button>
                </li>
              ) : (
                <li key={e.name} className="browser-file muted">
                  <span aria-hidden>📄</span> {e.name}
                </li>
              )
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

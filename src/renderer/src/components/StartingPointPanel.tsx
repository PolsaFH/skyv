import { useEffect, useState } from 'react'
import type { ChangeSet, CompareSummary } from '../../../core/api'
import type { StartingPointChoice } from '../../../core/types'
import { api, friendlyError, type FriendlyError } from '../api'
import { plural } from '../format'

interface Props {
  siteId: string
  changeSet: ChangeSet
  onDone: (cs?: ChangeSet) => void
}

/** Shown until the site has a starting point: choose one, or run "compare with server". */
export function StartingPointPanel({ siteId, changeSet, onDone }: Props) {
  const [busy, setBusy] = useState<null | 'quick' | 'deep' | StartingPointChoice>(null)
  const [progress, setProgress] = useState<string>('')
  const [error, setError] = useState<FriendlyError | null>(null)
  const [summary, setSummary] = useState<CompareSummary | null>(null)

  useEffect(
    () =>
      api.changes.onProgress((e) => {
        if (e.siteId !== siteId || e.kind !== 'compare') return
        setProgress(e.phase === 'listing' ? `Ser gjennom serveren: ${plural(e.done, 'mappe', 'mapper')}, ${plural(e.total, 'fil', 'filer')}` : `Sjekker innhold: ${e.done} av ${e.total}`)
      }),
    [siteId]
  )

  const choose = async (choice: StartingPointChoice) => {
    setBusy(choice)
    setError(null)
    try {
      onDone(await api.changes.setStartingPoint(siteId, choice))
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  const compare = async (deep: boolean) => {
    setBusy(deep ? 'deep' : 'quick')
    setError(null)
    setProgress('Kobler til …')
    try {
      setSummary(await api.changes.compare(siteId, deep))
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  if (summary) {
    return (
      <div className="card start-panel">
        <h2>Sammenligningen er ferdig</h2>
        <ul className="plain">
          <li>{plural(summary.same + summary.sameSizeUnverified, 'fil er lik', 'filer er like')} på Macen og serveren{summary.sameSizeUnverified > 0 ? ' (samme størrelse)' : ''}.</li>
          <li>{plural(summary.different.length, 'fil er forskjellig', 'filer er forskjellige')} og vises som endret.</li>
          <li>{plural(summary.onlyLocal, 'fil finnes', 'filer finnes')} bare på Macen og vises som {summary.onlyLocal === 1 ? 'ny' : 'nye'}.</li>
          {summary.onlyRemote.length > 0 && (
            <li>
              {plural(summary.onlyRemote.length, 'fil finnes', 'filer finnes')} bare på serveren. De blir liggende i fred.
            </li>
          )}
        </ul>
        <div>
          <button className="btn btn-primary" onClick={() => onDone()}>
            Vis endringene
          </button>
        </div>
      </div>
    )
  }

  if (changeSet.needsCompare) {
    return (
      <div className="card start-panel">
        <h2>Sammenlign med serveren</h2>
        <p className="lead">
          Skyv ser på filene på serveren og finner det som er forskjellig fra mappen på Macen. Ingenting blir endret på serveren.
        </p>
        <div className="choice-buttons">
          <button className="btn btn-primary" onClick={() => compare(false)} disabled={busy !== null}>
            Rask sjekk
          </button>
          <button className="btn" onClick={() => compare(true)} disabled={busy !== null}>
            Grundig sjekk
          </button>
        </div>
        <small className="muted">
          Rask sjekk ser bare på filstørrelser. Grundig sjekk laster ned filer med lik størrelse og sammenligner innholdet. Det tar lengre tid.
        </small>
        {busy && <div className="progress-text">{progress}</div>}
        {error && (
          <div className="notice notice-error">
            {error.message}
            {error.hint && <div>{error.hint}</div>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="card start-panel">
      <h2>Er serveren lik mappen på Macen nå?</h2>
      <p className="lead">Skyv må vite hvor den skal starte, før den kan vise hva som er endret.</p>
      <div className="choice-buttons">
        <button className="btn btn-primary" onClick={() => choose('assume-synced')} disabled={busy !== null}>
          Ja, start herfra
        </button>
        <button className="btn" onClick={() => choose('compare')} disabled={busy !== null}>
          Sammenlign med serveren
        </button>
        <button className="btn" onClick={() => choose('upload-all')} disabled={busy !== null}>
          Last opp alt
        </button>
      </div>
      {error && (
        <div className="notice notice-error">
          {error.message}
          {error.hint && <div>{error.hint}</div>}
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { LogEntry } from '../../../core/api'
import { api } from '../api'
import { Modal } from './Modal'
import { formatWhen } from '../format'

/** "Vis logg": everything Skyv has done for a site, newest first. Never contains passwords. */
export function LogDialog({ siteId, siteName, onClose }: { siteId: string; siteName: string; onClose: () => void }) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.logs.list(siteId).then(setEntries, () => setEntries([]))
  }, [siteId])

  const copy = async () => {
    if (!entries) return
    const text = entries
      .map((e) => `${e.at}  ${e.message}${e.details?.length ? '\n    ' + e.details.join('\n    ') : ''}`)
      .join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Modal title={`Logg for ${siteName}`} onClose={onClose} width={680}>
      {!entries && <div className="muted">Henter …</div>}
      {entries?.length === 0 && <div className="muted">Ingenting er logget ennå.</div>}
      {entries && entries.length > 0 && (
        <ul className="log-list">
          {entries.map((e, i) => (
            <li key={i}>
              <span className="log-when">{formatWhen(e.at)}</span>
              <div className="log-text">
                {e.message}
                {e.details && e.details.length > 0 && (
                  <details>
                    <summary className="muted">{e.details.length === 1 ? '1 detalj' : `${e.details.length} detaljer`}</summary>
                    <ul className="plain-list mono">
                      {e.details.map((d, j) => (
                        <li key={j}>{d}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="form-actions">
        <button className="btn" onClick={copy} disabled={!entries?.length}>
          {copied ? 'Kopiert' : 'Kopier logg'}
        </button>
        <span className="grow" />
        <button className="btn btn-primary" onClick={onClose}>
          Lukk
        </button>
      </div>
    </Modal>
  )
}

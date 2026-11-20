import { useEffect, useState } from 'react'
import { api, friendlyError, type FriendlyError } from '../api'
import { Modal } from './Modal'

interface Props {
  siteId: string
  keys: string[]
  /** First time: ask for consent. Later: just show what is sent. */
  firstTime: boolean
  onCancel: () => void
  onAccept: () => void
}

/** Shows exactly what is sent to the AI before it is used the first time. */
export function AiConsentDialog({ siteId, keys, firstTime, onCancel, onAccept }: Props) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)

  useEffect(() => {
    api.summary.preview(siteId, keys).then(setText, (e) => setError(friendlyError(e)))
  }, [siteId, keys])

  return (
    <Modal title={firstTime ? 'Skrive sammendrag med AI?' : 'Dette blir sendt til AI-en'} onClose={onCancel} width={620}>
      <div className="form">
        <p className="lead">
          Skyv sender teksten under til Anthropic (Claude) med din egen API-nøkkel, og får tilbake et kort notat. Bare linjene som er endret blir
          sendt, aldri hele filer, og aldri filer der Skyv har funnet nøkler eller passord. Linjer som ligner hemmelige verdier, blir byttet ut.
        </p>
        {!text && !error && <div className="muted">Lager oversikt …</div>}
        {error && <div className="notice notice-error">{error.message}</div>}
        {text && <pre className="ai-payload">{text}</pre>}
        <small className="muted">Du betaler selv for bruken hos Anthropic. Det vanlige sammendraget virker alltid uten AI.</small>
      </div>
      <div className="form-actions">
        <button className="btn" onClick={onCancel}>
          {firstTime ? 'Ikke nå' : 'Lukk'}
        </button>
        {firstTime && (
          <button className="btn btn-primary" onClick={onAccept} disabled={!text}>
            Send og skriv sammendrag
          </button>
        )}
      </div>
    </Modal>
  )
}

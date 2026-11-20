import { useEffect, useRef } from 'react'
import type { Protocol } from '../../../core/types'
import type { RemoteSessionInfo } from '../../../core/api'
import { api, friendlyError, type FriendlyError } from '../api'

export interface ConnectionValues {
  protocol: Protocol
  host: string
  port: string
  username: string
  password: string
  acceptSelfSigned: boolean
}

export const DEFAULT_PORT: Record<Protocol, number> = { ftp: 21, ftps: 21, sftp: 22 }

export type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; session: RemoteSessionInfo }
  | { kind: 'error'; error: FriendlyError }

interface Props {
  values: ConnectionValues
  onChange: (v: ConnectionValues) => void
  /** Existing site id, so a stored password can be used when the field is empty. */
  siteId?: string
  hasStoredPassword?: boolean
  test: TestState
  onTest: (state: TestState) => void
}

/** Shared fields for FTP/FTPS/SFTP details, with a "Test tilkobling" button. */
export function ConnectionFields({ values, onChange, siteId, hasStoredPassword, test, onTest }: Props) {
  const set = <K extends keyof ConnectionValues>(key: K, value: ConnectionValues[K]) => {
    const next = { ...values, [key]: value }
    if (key === 'protocol' && Number(values.port) === DEFAULT_PORT[values.protocol]) {
      next.port = String(DEFAULT_PORT[value as Protocol])
    }
    onChange(next)
  }

  // Any change to the fields makes a previous test result stale.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (test.kind === 'ok') void api.remote.close(test.session.sessionId)
    if (test.kind !== 'idle' && test.kind !== 'testing') onTest({ kind: 'idle' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.protocol, values.host, values.port, values.username, values.password, values.acceptSelfSigned])

  const runTest = async () => {
    if (test.kind === 'ok') await api.remote.close(test.session.sessionId)
    onTest({ kind: 'testing' })
    try {
      const session = await api.remote.open({
        siteId,
        protocol: values.protocol,
        host: values.host,
        port: Number(values.port),
        username: values.username,
        password: values.password || undefined,
        acceptSelfSigned: values.acceptSelfSigned
      })
      onTest({ kind: 'ok', session })
    } catch (err) {
      onTest({ kind: 'error', error: friendlyError(err) })
    }
  }

  return (
    <div className="form">
      <label className="field">
        <span>Tilkobling</span>
        <select value={values.protocol} onChange={(e) => set('protocol', e.target.value as Protocol)}>
          <option value="ftp">FTP</option>
          <option value="ftps">FTP med kryptering (FTPS)</option>
          <option value="sftp">SFTP</option>
        </select>
        <small className="muted">Er du usikker, velg FTP. Webhotellet oppgir hva de støtter.</small>
      </label>
      <div className="row">
        <label className="field grow">
          <span>Vert</span>
          <input
            value={values.host}
            onChange={(e) => set('host', e.target.value)}
            placeholder="ftp.minside.no"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
          />
        </label>
        <label className="field port">
          <span>Port</span>
          <input value={values.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
        </label>
      </div>
      <label className="field">
        <span>Brukernavn</span>
        <input value={values.username} onChange={(e) => set('username', e.target.value)} autoCapitalize="off" spellCheck={false} autoComplete="off" />
      </label>
      <label className="field">
        <span>Passord</span>
        <input
          type="password"
          value={values.password}
          onChange={(e) => set('password', e.target.value)}
          placeholder={hasStoredPassword ? 'Lagret. Skriv nytt for å bytte.' : ''}
          autoComplete="new-password"
        />
        <small className="muted">Lagres kryptert i nøkkelringen på Macen.</small>
      </label>
      {values.protocol === 'ftps' && (
        <label className="check">
          <input type="checkbox" checked={values.acceptSelfSigned} onChange={(e) => set('acceptSelfSigned', e.target.checked)} />
          <span>
            Godta selvlaget sertifikat
            <small className="warn-text">
              Bruk bare dette hvis webhotellet sier at det er nødvendig. Da kan ikke Skyv sjekke at du snakker med riktig server.
            </small>
          </span>
        </label>
      )}

      <div className="test-row">
        <button type="button" className="btn" onClick={runTest} disabled={test.kind === 'testing' || !values.host || !values.username}>
          {test.kind === 'testing' ? 'Kobler til …' : 'Test tilkobling'}
        </button>
        {test.kind === 'ok' && (
          <span className="test-ok" role="status">
            ✓ Tilkoblingen virker
          </span>
        )}
      </div>
      {test.kind === 'error' && (
        <div className="notice notice-error" role="alert">
          <strong>{test.error.message}</strong>
          {test.error.hint && <div>{test.error.hint}</div>}
        </div>
      )}
    </div>
  )
}

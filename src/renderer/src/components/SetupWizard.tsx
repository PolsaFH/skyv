import { useEffect, useRef, useState } from 'react'
import type { SiteView, StartingPointChoice } from '../../../core/types'
import { api, friendlyError, type FriendlyError } from '../api'
import { Modal } from './Modal'
import { ConnectionFields, type ConnectionValues, type TestState } from './ConnectionFields'
import { RemoteFolderPicker } from './RemoteFolderPicker'

interface Props {
  initialPath?: string
  onClose: () => void
  onSaved: (site: SiteView) => void
}

const STEPS = ['Mappe', 'Webhotell', 'Mappe på serveren', 'Nettadresse', 'Utgangspunkt'] as const

function folderName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || ''
}

/** "minside.no" -> "https://minside.no"; anything not domain-like gives "". */
export function suggestUrl(name: string): string {
  const n = name.trim().toLowerCase()
  return /^[a-z0-9æøå-]+(\.[a-z0-9æøå-]+)+$/.test(n) ? `https://${n}` : ''
}

const STARTING_POINTS: Array<{ value: StartingPointChoice; title: string; text: string }> = [
  {
    value: 'assume-synced',
    title: 'Ja, start herfra',
    text: 'Serveren har allerede det samme som mappen på Macen. Bare endringer du gjør fra nå av blir gitt ut.'
  },
  {
    value: 'compare',
    title: 'Sammenlign med serveren',
    text: 'Skyv ser på filene på serveren og viser hva som er forskjellig. Du velger selv hva som skal gis ut.'
  },
  {
    value: 'upload-all',
    title: 'Last opp alt',
    text: 'Alle filene i mappen blir gitt ut som første utgivelse. Passer for en ny nettside eller en tom mappe på serveren.'
  }
]

export function SetupWizard({ initialPath, onClose, onSaved }: Props) {
  const [step, setStep] = useState(0)
  const [localPath, setLocalPath] = useState(initialPath ?? '')
  const [name, setName] = useState(initialPath ? folderName(initialPath) : '')
  const [conn, setConn] = useState<ConnectionValues>({
    protocol: 'ftp',
    host: '',
    port: '21',
    username: '',
    password: '',
    acceptSelfSigned: false
  })
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [remoteRoot, setRemoteRoot] = useState('')
  const [url, setUrl] = useState('')
  const [urlTouched, setUrlTouched] = useState(false)
  const [startingPoint, setStartingPoint] = useState<StartingPointChoice>('assume-synced')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<FriendlyError | null>(null)

  // Close any open server connection when the wizard goes away.
  const sessionRef = useRef<string | null>(null)
  sessionRef.current = test.kind === 'ok' ? test.session.sessionId : null
  useEffect(() => () => void (sessionRef.current && api.remote.close(sessionRef.current)), [])

  // A new connection invalidates the chosen remote folder.
  useEffect(() => {
    if (test.kind !== 'ok') setRemoteRoot('')
  }, [test.kind])

  useEffect(() => {
    if (!urlTouched) setUrl(suggestUrl(name))
  }, [name, urlTouched])

  const chooseFolder = async () => {
    const folder = await api.files.chooseFolder()
    if (!folder) return
    if (!name || name === folderName(localPath)) setName(folderName(folder))
    setLocalPath(folder)
  }

  const canNext = [
    Boolean(localPath && name.trim()),
    test.kind === 'ok',
    Boolean(remoteRoot),
    true,
    true
  ][step]

  const finish = async () => {
    if (test.kind !== 'ok') return
    setSaving(true)
    setError(null)
    try {
      const site = await api.sites.create(
        {
          name,
          localPath,
          protocol: conn.protocol,
          host: conn.host,
          port: Number(conn.port),
          username: conn.username,
          remoteRoot,
          url,
          sftpHostKey: test.session.sftpHostKey,
          startingPoint: { choice: startingPoint, chosenAt: new Date().toISOString(), applied: false },
          settings: { acceptSelfSigned: conn.acceptSelfSigned }
        },
        conn.password
      )
      onSaved(site)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Ny nettside" onClose={onClose} width={600}>
      <ol className="steps" aria-label="Steg">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="step-num">{i < step ? '✓' : i + 1}</span>
            <span className="step-label">{label}</span>
          </li>
        ))}
      </ol>

      <div className="wizard-body">
        {step === 0 && (
          <div className="form">
            <p className="lead">Hvilken mappe på Macen inneholder nettsiden?</p>
            <label className="field">
              <span>Mappe på Macen</span>
              <div className="row">
                <input value={localPath} readOnly placeholder="Ingen mappe valgt" />
                <button type="button" className="btn" onClick={chooseFolder}>
                  Velg …
                </button>
              </div>
            </label>
            <label className="field">
              <span>Navn på nettsiden</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="minside.no" />
              <small className="muted">Bare for deg, slik at du kjenner den igjen i listen.</small>
            </label>
          </div>
        )}

        {step === 1 && (
          <>
            <p className="lead">Skriv inn FTP-opplysningene du har fått fra webhotellet.</p>
            <ConnectionFields values={conn} onChange={setConn} test={test} onTest={setTest} />
          </>
        )}

        {step === 2 && test.kind === 'ok' && (
          <RemoteFolderPicker
            sessionId={test.session.sessionId}
            homeDir={test.session.homeDir}
            localPath={localPath}
            siteName={name}
            value={remoteRoot}
            onChange={setRemoteRoot}
          />
        )}

        {step === 3 && (
          <div className="form">
            <p className="lead">Hva er adressen til nettsiden? Skyv bruker den til å sjekke at siden virker etter hver utgivelse.</p>
            <label className="field">
              <span>Nettadresse</span>
              <input
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  setUrlTouched(true)
                }}
                placeholder="https://minside.no"
                autoCapitalize="off"
                spellCheck={false}
                autoFocus
              />
              <small className="muted">Kan stå tom og legges inn senere.</small>
            </label>
          </div>
        )}

        {step === 4 && (
          <div className="form">
            <p className="lead">Er serveren lik mappen på Macen nå?</p>
            <div className="choice-list" role="radiogroup" aria-label="Utgangspunkt">
              {STARTING_POINTS.map((sp) => (
                <label key={sp.value} className={`choice ${startingPoint === sp.value ? 'chosen' : ''}`}>
                  <input type="radio" name="starting-point" checked={startingPoint === sp.value} onChange={() => setStartingPoint(sp.value)} />
                  <span>
                    <strong>{sp.title}</strong>
                    <small className="muted">{sp.text}</small>
                  </span>
                </label>
              ))}
            </div>
            {startingPoint === 'upload-all' && (
              <div className="notice notice-warn">
                Filer med samme navn på serveren blir erstattet. Skyv tar sikkerhetskopi av dem først, slik at du kan angre.
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="notice notice-error" role="alert">
            {error.message}
            {error.hint && <div>{error.hint}</div>}
          </div>
        )}
      </div>

      <div className="form-actions">
        {step > 0 ? (
          <button type="button" className="btn" onClick={() => setStep(step - 1)}>
            Tilbake
          </button>
        ) : (
          <button type="button" className="btn" onClick={onClose}>
            Avbryt
          </button>
        )}
        <span className="grow" />
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
            Neste
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={saving} onClick={finish}>
            Legg til nettside
          </button>
        )}
      </div>
    </Modal>
  )
}

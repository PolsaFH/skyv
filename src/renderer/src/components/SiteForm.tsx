import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { checkIgnoreRules, DEFAULT_IGNORE_RULES } from '../../../core/scan/ignoreRules'
import type { SiteView } from '../../../core/types'
import { api, friendlyError, type FriendlyError } from '../api'
import { Modal } from './Modal'
import { ConnectionFields, type ConnectionValues, type TestState } from './ConnectionFields'
import { ConfirmDialog } from './ConfirmDialog'

interface Props {
  site: SiteView
  onClose: () => void
  onSaved: (site: SiteView) => void
  onRemoved: () => void
}

/** Settings for an existing site. New sites go through the setup wizard. */
export function SiteForm({ site, onClose, onSaved, onRemoved }: Props) {
  const [localPath, setLocalPath] = useState(site.localPath)
  const [name, setName] = useState(site.name)
  const [conn, setConn] = useState<ConnectionValues>({
    protocol: site.protocol,
    host: site.host,
    port: String(site.port),
    username: site.username,
    password: '',
    acceptSelfSigned: site.settings.acceptSelfSigned
  })
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [remoteRoot, setRemoteRoot] = useState(site.remoteRoot)
  const [url, setUrl] = useState(site.url)
  const [ignoreRules, setIgnoreRules] = useState(site.ignoreRules)
  const [ignoreSourceMaps, setIgnoreSourceMaps] = useState(site.settings.ignoreSourceMaps)
  const [autoUndo, setAutoUndo] = useState(site.settings.autoUndoOnFailedCheck)
  const [bgCheck, setBgCheck] = useState(site.settings.serverCheckInBackground)
  const ruleProblems = useMemo(() => checkIgnoreRules(ignoreRules), [ignoreRules])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [php, setPhp] = useState<{ found: boolean; version?: string; path?: string } | null>(null)
  const [aiFile, setAiFile] = useState<'none' | 'present' | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiDone, setAiDone] = useState<string | null>(null)

  useEffect(() => {
    if (site.localPath) api.sites.aiInstructions(site.id, 'status').then(setAiFile, () => setAiFile(null))
  }, [site.id, site.localPath])

  const aiInstructions = async (action: 'write' | 'remove') => {
    setAiBusy(true)
    setError(null)
    setAiDone(null)
    try {
      setAiFile(await api.sites.aiInstructions(site.id, action))
      setAiDone(action === 'write' ? 'Instruksjonene ligger nå i CLAUDE.md i mappen til nettsiden.' : 'Instruksjonene er fjernet fra CLAUDE.md.')
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setAiBusy(false)
    }
  }

  useEffect(() => {
    api.system.phpInfo().then(setPhp, () => setPhp({ found: false }))
  }, [])

  const sessionRef = useRef<string | null>(null)
  sessionRef.current = test.kind === 'ok' ? test.session.sessionId : null
  useEffect(() => () => void (sessionRef.current && api.remote.close(sessionRef.current)), [])

  const chooseFolder = async () => {
    const folder = await api.files.chooseFolder()
    if (folder) setLocalPath(folder)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const saved = await api.sites.update(
        site.id,
        {
          name,
          localPath,
          protocol: conn.protocol,
          host: conn.host,
          port: Number(conn.port),
          username: conn.username,
          remoteRoot,
          url,
          ignoreRules,
          // Remember the SFTP server identity seen during a successful test.
          ...(test.kind === 'ok' && test.session.sftpHostKey ? { sftpHostKey: test.session.sftpHostKey } : {}),
          settings: { acceptSelfSigned: conn.acceptSelfSigned, ignoreSourceMaps, autoUndoOnFailedCheck: autoUndo, serverCheckInBackground: bgCheck }
        },
        conn.password ? conn.password : undefined
      )
      onSaved(saved)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Innstillinger for ${site.name}`} onClose={onClose} width={560}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Navn</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Mappe på Macen</span>
          <div className="row">
            <input value={localPath} readOnly />
            <button type="button" className="btn" onClick={chooseFolder}>
              Velg …
            </button>
          </div>
        </label>

        <fieldset className="group">
          <legend>Opplysninger fra webhotellet</legend>
          <ConnectionFields values={conn} onChange={setConn} siteId={site.id} hasStoredPassword={site.hasPassword} test={test} onTest={setTest} />
          <label className="field">
            <span>Mappe på serveren</span>
            <input value={remoteRoot} onChange={(e) => setRemoteRoot(e.target.value)} placeholder="/public_html" spellCheck={false} />
          </label>
        </fieldset>

        <label className="field">
          <span>Nettadresse</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://minside.no" spellCheck={false} autoCapitalize="off" />
          <small className="muted">Etter hver utgivelse henter Skyv de endrede sidene herfra og sjekker at de virker.</small>
        </label>
        <label className="check">
          <input type="checkbox" checked={autoUndo} onChange={(e) => setAutoUndo(e.target.checked)} />
          <span>
            Angre automatisk hvis sjekken feiler
            <small className="muted">
              Hvis en side ikke svarer, viser en PHP-feil eller mangler bilder, CSS eller JS etter utgivelsen, legger Skyv tilbake forrige versjon med en gang.
            </small>
          </span>
        </label>

        <label className="check">
          <input type="checkbox" checked={bgCheck} onChange={(e) => setBgCheck(e.target.checked)} />
          <span>
            Sjekk serveren i bakgrunnen hvert 15. minutt
            <small className="muted">
              Skyv sjekker alltid serveren når du åpner nettsiden (hvis det er mer enn 5 minutter siden sist). Slå dette på bare hvis andre også endrer filer
              på serveren. Av som standard, for å skåne webhotellet.
            </small>
          </span>
        </label>

        <fieldset className="group">
          <legend>Filer som aldri skal lastes opp</legend>
          <p className="muted small-text">
            Skyv hopper alltid over {DEFAULT_IGNORE_RULES.filter((r) => !r.startsWith('*.skyv') && r !== '._*').slice(0, 9).join(', ')}, instruksjoner for AI
            (CLAUDE.md, AGENTS.md, .claude) og lignende.
            Her kan du legge til flere, én per linje. Eksempler: <span className="mono">utkast/</span> (en hel mappe),{' '}
            <span className="mono">*.psd</span> (alle filer som slutter på .psd), <span className="mono">notater.txt</span> (én fil). En linje som
            starter med # er en kommentar. Du kan også legge en fil som heter <span className="mono">.skyvignore</span> i mappen til nettsiden.
          </p>
          <label className="field">
            <span>Egne regler</span>
            <textarea rows={4} value={ignoreRules} onChange={(e) => setIgnoreRules(e.target.value)} spellCheck={false} className="mono" placeholder={'utkast/\n*.psd'} />
          </label>
          {ruleProblems.length > 0 && (
            <div className="notice notice-warn">
              {ruleProblems.map((p) => (
                <div key={p}>{p}</div>
              ))}
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={ignoreSourceMaps} onChange={(e) => setIgnoreSourceMaps(e.target.checked)} />
            <span>
              Hopp over kildekart (filer som slutter på .map)
              <small className="muted">Brukes bare av utviklere til feilsøking og trengs ikke på nettsiden.</small>
            </span>
          </label>
        </fieldset>

        {aiFile && (
          <fieldset className="group">
            <legend>Instruksjoner for AI</legend>
            <p className="muted small-text">
              Bruker du Claude Code i mappen til nettsiden, kan Skyv skrive en kort fast arbeidsflyt i <span className="mono">CLAUDE.md</span>: sjekk, se på
              resultatet, klargjør en utgivelse med notat, og la deg trykke "Gi ut". Skyv endrer bare sin egen del av filen. CLAUDE.md, AGENTS.md og
              mappen .claude lastes aldri opp til webhotellet.
            </p>
            <div className="choice-buttons">
              <button type="button" className="btn btn-small" disabled={aiBusy} onClick={() => void aiInstructions('write')}>
                {aiFile === 'present' ? 'Oppdater Skyv-instruksjonene' : 'Legg til Skyv-instruksjoner for AI'}
              </button>
              {aiFile === 'present' && (
                <button type="button" className="btn btn-small" disabled={aiBusy} onClick={() => void aiInstructions('remove')}>
                  Fjern Skyv-instruksjonene
                </button>
              )}
            </div>
            {aiDone && (
              <div className="muted small-text" role="status">
                {aiDone}
              </div>
            )}
          </fieldset>
        )}

        {php && (
          <div className={`php-note ${php.found ? 'php-ok' : ''}`} role="status">
            {php.found ? (
              <>
                <strong>PHP er funnet</strong> (versjon {php.version}). Skyv bruker det til å sjekke PHP-filer for feil før utgivelse, og til å vise
                PHP-sider i lokal forhåndsvisning.
              </>
            ) : (
              <>
                <strong>PHP ble ikke funnet på Macen.</strong> Sjekken av PHP-filer hoppes over, og lokal forhåndsvisning viser bare den ekte
                nettsiden. Installer PHP med Homebrew for å slå dette på.
              </>
            )}
          </div>
        )}

        {error && (
          <div className="notice notice-error" role="alert">
            {error.message}
            {error.hint && <div>{error.hint}</div>}
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="btn btn-danger-ghost" onClick={() => setConfirmRemove(true)}>
            Fjern fra Skyv …
          </button>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Avbryt
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || ruleProblems.length > 0}>
            Lagre
          </button>
        </div>
      </form>
      {confirmRemove && (
        <ConfirmDialog
          title={`Fjerne ${site.name} fra Skyv?`}
          confirmLabel="Fjern fra Skyv"
          danger
          onCancel={() => setConfirmRemove(false)}
          onConfirm={async () => {
            try {
              await api.sites.remove(site.id)
              setConfirmRemove(false)
              onRemoved()
            } catch (e) {
              setConfirmRemove(false)
              setError(friendlyError(e))
            }
          }}
        >
          <p>Dette skjer:</p>
          <ul>
            <li>Oppsettet, historikken og sikkerhetskopiene i Skyv fjernes.</li>
            <li>Det lagrede passordet fjernes fra nøkkelringen.</li>
          </ul>
          <p>Dette skjer ikke:</p>
          <ul>
            <li>Filene i mappen på Macen blir liggende urørt.</li>
            <li>Ingenting på serveren blir endret eller slettet.</li>
          </ul>
        </ConfirmDialog>
      )}
    </Modal>
  )
}

import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../core/api'
import { api, friendlyError, type FriendlyError } from '../api'
import { Modal } from './Modal'

/** Settings for the whole app: login, menu bar, Dock and notifications. */
export function AppSettingsDialog({ onClose, onOpenAgent }: { onClose: () => void; onOpenAgent: () => void }) {
  const [s, setS] = useState<AppSettings | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)

  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [transferMsg, setTransferMsg] = useState<string | null>(null)

  useEffect(() => {
    api.app.getSettings().then(setS, (e) => setError(friendlyError(e)))
    api.summary.hasKey().then(setHasKey, () => undefined)
  }, [])

  const saveKey = async (key: string | null) => {
    setError(null)
    try {
      await api.summary.setKey(key)
      setHasKey(key !== null)
      setKeyInput('')
      if (key === null) await change({ aiSummaries: false })
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  const doExport = async () => {
    setTransferMsg(null)
    try {
      const n = await api.transfer.exportSites()
      if (n !== null) setTransferMsg(`${n === 1 ? '1 nettside' : `${n} nettsider`} er eksportert. Passord er ikke med.`)
    } catch (e) {
      setError(friendlyError(e))
    }
  }
  const doImport = async () => {
    setTransferMsg(null)
    try {
      const r = await api.transfer.importSites()
      if (!r) return
      const parts = [`${r.imported.length === 1 ? '1 nettside' : `${r.imported.length} nettsider`} importert`]
      if (r.skipped.length > 0) parts.push(`${r.skipped.length} hoppet over (${r.skipped.map((x) => `${x.name}: ${x.reason}`).join('; ')})`)
      if (r.missingFolder.length > 0) parts.push(`mappen finnes ikke på denne Macen for ${r.missingFolder.join(', ')}`)
      setTransferMsg(parts.join(', ') + '. Legg inn passordene i innstillingene for hver nettside.')
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  const change = async (patch: Partial<AppSettings>) => {
    try {
      setS(await api.app.setSettings(patch))
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  return (
    <Modal title="Innstillinger for Skyv" onClose={onClose} width={540}>
      {!s && !error && <div className="muted">Henter …</div>}
      {s && (
        <div className="form">
          <label className="check">
            <input type="checkbox" checked={s.openAtLogin} onChange={(e) => change({ openAtLogin: e.target.checked })} />
            <span>
              Start Skyv når du logger inn
              <small className="muted">Skyv starter i menylinjen og passer på mappene dine.</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.keepRunningInBackground} disabled={!s.showDockIcon} onChange={(e) => change({ keepRunningInBackground: e.target.checked })} />
            <span>
              Fortsett i bakgrunnen når vinduet lukkes
              <small className="muted">Skyv blir værende i menylinjen og sier fra når du har endringer som er klare.</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.showDockIcon} onChange={(e) => change({ showDockIcon: e.target.checked })} />
            <span>
              Vis Skyv i Dock
              <small className="muted">Uten Dock-ikon finner du Skyv i menylinjen øverst til høyre.</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.notifications} onChange={(e) => change({ notifications: e.target.checked })} />
            <span>
              Varsle når endringer er klare
              <small className="muted">Når filene har sluttet å endre seg en stund, sier Skyv fra med et varsel.</small>
            </span>
          </label>
          <fieldset className="group">
            <legend>AI-tilkobling</legend>
            <p className="muted small-text">La Claude Code eller Claude-appen se og klargjøre utgivelser i Skyv, med tillatelser du velger per nettside.</p>
            <div>
              <button className="btn" onClick={onOpenAgent}>
                AI-tilkobling …
              </button>
            </div>
          </fieldset>

          <fieldset className="group">
            <legend>Sammendrag med AI</legend>
            <p className="muted small-text">
              Av som standard. Skyv skriver alltid et vanlig sammendrag selv. Med din egen API-nøkkel fra Anthropic kan Claude skrive et litt mer
              menneskelig notat. Bare endrede linjer sendes, aldri filer med nøkler eller passord, og du ser hva som sendes før første gang.
            </p>
            <label className="field">
              <span>API-nøkkel fra Anthropic</span>
              <div className="row">
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder={hasKey ? 'Lagret i nøkkelringen. Skriv ny for å bytte.' : 'sk-ant-…'}
                  autoComplete="off"
                />
                <button className="btn" onClick={() => void saveKey(keyInput)} disabled={!keyInput}>
                  Lagre
                </button>
                {hasKey && (
                  <button className="btn btn-danger-ghost" onClick={() => void saveKey(null)}>
                    Fjern
                  </button>
                )}
              </div>
            </label>
            <label className="check">
              <input type="checkbox" checked={s.aiSummaries} disabled={!hasKey} onChange={(e) => change({ aiSummaries: e.target.checked })} />
              <span>
                Skriv sammendrag med AI
                {!hasKey && <small className="muted">Legg inn en API-nøkkel først.</small>}
              </span>
            </label>
          </fieldset>

          <fieldset className="group">
            <legend>Flytt oppsett</legend>
            <p className="muted small-text">Lagre oppsettet for alle nettsidene i en fil, for eksempel for å ta det med til en annen Mac. Passord blir aldri med.</p>
            <div className="choice-buttons">
              <button className="btn" onClick={() => void doExport()}>
                Eksporter nettsider …
              </button>
              <button className="btn" onClick={() => void doImport()}>
                Importer nettsider …
              </button>
            </div>
            {transferMsg && <div className="small-text">{transferMsg}</div>}
          </fieldset>

          <label className="field">
            <span>Tallet i menylinjen viser</span>
            <select value={s.trayCount} onChange={(e) => change({ trayCount: e.target.value as AppSettings['trayCount'] })}>
              <option value="all">Endringer i alle nettsider</option>
              <option value="selected">Endringer i nettsiden som er valgt</option>
            </select>
          </label>
        </div>
      )}
      {error && <div className="notice notice-error">{error.message}</div>}
      <div className="form-actions">
        <button className="btn btn-primary" onClick={onClose}>
          Ferdig
        </button>
      </div>
    </Modal>
  )
}

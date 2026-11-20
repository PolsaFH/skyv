import { useEffect, useState } from 'react'
import type { AgentLevel, AgentSettings } from '../../../core/api'
import type { SiteView } from '../../../core/types'
import { api, friendlyError, type FriendlyError } from '../api'
import { Modal } from './Modal'
import { formatAgo } from '../format'
import { METHOD_LABEL } from '../../../core/agentApi/labels'

type Setup = Awaited<ReturnType<typeof api.agent.setupInfo>>

const LEVELS: Array<{ value: AgentLevel; label: string; text: string }> = [
  { value: 'read', label: 'Bare se', text: 'AI-en kan se endringer, historikk og resultatet av sjekkene.' },
  { value: 'prepare', label: 'Se og klargjøre', text: 'I tillegg kan den klargjøre utgivelser som du godkjenner.' },
  { value: 'release', label: 'Se, klargjøre og gi ut', text: 'Den kan også gi ut selv, men bare når alle sperrene er oppfylt.' }
]


function CopyBox({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="copy-box">
      <pre className="mono">{text}</pre>
      <button
        className="btn btn-small"
        onClick={async () => {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        aria-label={`Kopier ${label}`}
      >
        {copied ? 'Kopiert' : 'Kopier'}
      </button>
    </div>
  )
}

/** "AI-tilkobling": main switch, level per site, setup for Claude, command line, clients and recent actions. */
export function AgentSettingsDialog({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<AgentSettings | null>(null)
  const [sites, setSites] = useState<SiteView[]>([])
  const [setup, setSetup] = useState<Setup | null>(null)
  const [installMsg, setInstallMsg] = useState<string | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)

  useEffect(() => {
    api.agent.getSettings().then(setS, (e) => setError(friendlyError(e)))
    api.sites.list().then(setSites, () => undefined)
    api.agent.setupInfo().then(setSetup, () => undefined)
    return api.agent.onUpdated(setS)
  }, [])

  const run = async (fn: () => Promise<AgentSettings>) => {
    setError(null)
    try {
      setS(await fn())
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  const install = async () => {
    setInstallMsg(null)
    setError(null)
    try {
      const r = await api.agent.installCli()
      const lines = [r.action === 'created' ? `Kommandoen er lagt i ${r.path}.` : `Kommandoen i ${r.path} er oppdatert.`]
      if (!r.onPath) {
        lines.push(
          'Mappen ~/.local/bin er kanskje ikke med der Terminal leter etter kommandoer. Hvis "skyv" ikke virker i Terminal, legg til denne linjen i filen ~/.zprofile og åpne Terminal på nytt:',
          'export PATH="$HOME/.local/bin:$PATH"'
        )
      }
      setInstallMsg(lines.join('\n'))
      setSetup(await api.agent.setupInfo())
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  return (
    <Modal title="AI-tilkobling" onClose={onClose} width={680}>
      {!s && !error && <div className="muted">Henter …</div>}
      {s && (
        <div className="form agent-settings">
          <p className="lead">
            La en AI du allerede bruker (Claude Code eller Claude-appen) se nettsidene dine i Skyv, kjøre sjekkene og klargjøre utgivelser. Du godkjenner i
            Skyv. Ingen API-nøkkel trengs. AI-en ser aldri passord, og kan aldri omgå sjekkene, slette filer eller endre disse innstillingene.
          </p>
          <label className="check">
            <input type="checkbox" checked={s.enabled} onChange={(e) => run(() => api.agent.setEnabled(e.target.checked))} />
            <span>
              <strong>Slå på AI-tilkobling</strong>
              <small className="muted">Av som standard. Når den er av, svarer Skyv bare at tilkoblingen er slått av.</small>
            </span>
          </label>

          <fieldset className="group">
            <legend>Hva AI-en får gjøre per nettside</legend>
            {sites.length === 0 && <div className="muted small-text">Ingen nettsider ennå.</div>}
            {sites.map((site) => {
              const level = s.levels[site.id] ?? 'read'
              return (
                <div key={site.id} className="level-row">
                  <span className="level-site">{site.name}</span>
                  <select value={level} onChange={(e) => run(() => api.agent.setLevel(site.id, e.target.value as AgentLevel))} aria-label={`Nivå for ${site.name}`}>
                    {LEVELS.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <small className="muted level-text">{LEVELS.find((l) => l.value === level)!.text}</small>
                </div>
              )
            })}
            <small className="muted">
              Også på det høyeste nivået stopper Skyv utgivelser med røde funn, konflikter, avvik på serveren, slettinger eller filer som er endret etter at
              utkastet ble laget.
            </small>
          </fieldset>

          {setup && (
            <fieldset className="group">
              <legend>Koble til</legend>
              <div className="small-text">
                <strong>Claude Code:</strong> kjør denne kommandoen i Terminal.
              </div>
              <CopyBox text={setup.claudeCodeCommand} label="kommandoen for Claude Code" />
              <div className="small-text">
                <strong>Claude-appen:</strong> legg dette i <span className="mono">{setup.claudeDesktopConfigPath.replace(/^\/Users\/[^/]+/, '~')}</span>, og start
                Claude-appen på nytt. Finnes filen fra før, legg bare til «skyv» under «mcpServers».
              </div>
              <CopyBox text={setup.claudeDesktopJson} label="oppsettet for Claude-appen" />
              {!setup.packaged && <small className="warn-text">Dette er en utviklerversjon av Skyv. Oppsettet peker til prosjektmappen.</small>}
              <small className="muted">Første gang en AI kobler til, spør Skyv om du vil tillate det.</small>
            </fieldset>
          )}

          <fieldset className="group">
            <legend>Kommandolinje</legend>
            <p className="muted small-text">
              Kommandoen <span className="mono">skyv</span> gir de samme mulighetene i Terminal (for eksempel <span className="mono">skyv status</span>,{' '}
              <span className="mono">skyv check</span>, <span className="mono">skyv prepare -m "notat"</span>), med de samme tillatelsene. Den legges i{' '}
              <span className="mono">~/.local/bin</span>, uten administratorrettigheter.
            </p>
            <div className="choice-buttons">
              <button className="btn" onClick={() => void install()}>
                {setup?.cliInstalledAt ? 'Oppdater kommandoen skyv' : 'Installer kommandoen skyv'}
              </button>
              {setup?.cliInstalledAt && <span className="muted small-text">Installert i {setup.cliInstalledAt.replace(/^\/Users\/[^/]+/, '~')}</span>}
            </div>
            {installMsg && <pre className="install-msg">{installMsg}</pre>}
          </fieldset>

          <fieldset className="group">
            <legend>Tilkoblede AI-er</legend>
            {s.clients.length === 0 && <div className="muted small-text">Ingen har koblet til ennå.</div>}
            {s.clients.map((c) => (
              <div key={c.id} className="client-row">
                <span>
                  <strong>{c.name}</strong> <span className={c.status === 'approved' ? 'ok-inline' : 'danger-text'}>{c.status === 'approved' ? 'tillatt' : 'ikke tillatt'}</span>
                  <small className="muted"> · sist {formatAgo(c.lastSeen)}</small>
                </span>
                <button className="btn btn-small" onClick={() => run(() => api.agent.removeClient(c.id))}>
                  Koble fra
                </button>
              </div>
            ))}
            {s.clients.length > 0 && <small className="muted">Etter "Koble fra" må AI-en godkjennes på nytt neste gang.</small>}
          </fieldset>

          <fieldset className="group">
            <legend>Siste handlinger fra AI</legend>
            {s.recent.length === 0 && <div className="muted small-text">Ingenting ennå.</div>}
            <ul className="plain-list recent-list">
              {s.recent.slice(0, 25).map((a, i) => (
                <li key={i}>
                  <span className="muted">{formatAgo(a.at)}:</span> {a.clientName} {METHOD_LABEL[a.method] ?? a.method}
                  {a.siteName ? ` (${a.siteName})` : ''}
                  {!a.ok && <span className="danger-text"> · avvist{a.note ? `: ${a.note}` : ''}</span>}
                </li>
              ))}
            </ul>
          </fieldset>
        </div>
      )}
      {error && (
        <div className="notice notice-error">
          {error.message}
          {error.hint && <div>{error.hint}</div>}
        </div>
      )}
      <div className="form-actions">
        <button className="btn btn-primary" onClick={onClose}>
          Ferdig
        </button>
      </div>
    </Modal>
  )
}

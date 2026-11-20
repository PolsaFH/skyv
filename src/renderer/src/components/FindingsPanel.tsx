import { useState } from 'react'
import type { Finding } from '../../../core/api'
import { plural } from '../format'

interface Props {
  findings: Finding[]
  ignoredCount: number
  loading: boolean
  acknowledged: boolean
  onAcknowledge: (v: boolean) => void
  onIgnore: (f: Finding) => void
  onShowIgnored: () => void
  onOpenFile: (path: string) => void
}

const SEV = {
  block: { icon: '⛔', title: 'Stopper utgivelsen', cls: 'sev-block' },
  warn: { icon: '⚠', title: 'Advarsler', cls: 'sev-warn' },
  info: { icon: 'ℹ', title: 'Tips', cls: 'sev-info' }
} as const

/** Results of the checks before release, shown above the release button. */
export function FindingsPanel({ findings, ignoredCount, loading, acknowledged, onAcknowledge, onIgnore, onShowIgnored, onOpenFile }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({ block: true, warn: true, info: false })
  const groups = (['block', 'warn', 'info'] as const).map((s) => ({ s, items: findings.filter((f) => f.severity === s) })).filter((g) => g.items.length > 0)

  if (findings.length === 0) {
    return (
      <div className="findings-ok muted">
        {loading ? 'Sjekker filene …' : '✓ Ingen problemer funnet i filene som skal ut.'}
        {ignoredCount > 0 && (
          <>
            {' '}
            <button className="link-btn" onClick={onShowIgnored}>
              {plural(ignoredCount, 'funn er ignorert', 'funn er ignorert')}. Vis igjen
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="findings" aria-live="polite">
      {groups.map(({ s, items }) => (
        <section key={s} className={`finding-group ${SEV[s].cls}`}>
          <button className="finding-group-head" onClick={() => setOpen({ ...open, [s]: !open[s] })} aria-expanded={open[s]}>
            <span aria-hidden>{SEV[s].icon}</span> {SEV[s].title} <span className="finding-count">{items.length}</span>
            <span className="grow" />
            <span aria-hidden className="muted">{open[s] ? '▴' : '▾'}</span>
          </button>
          {open[s] && (
            <ul className="finding-list">
              {items.map((f) => (
                <li key={f.key + (f.line ?? '')} className="finding">
                  <div className="finding-text">
                    {f.path && (
                      <button className="link-btn mono" onClick={() => onOpenFile(f.path)} title="Vis filen i listen">
                        {f.path}
                        {f.line ? `:${f.line}` : ''}
                      </button>
                    )}{' '}
                    {f.message}
                    {f.hint && <div className="muted small-text">{f.hint}</div>}
                  </div>
                  <button className="btn btn-small finding-ignore" onClick={() => onIgnore(f)} title="Skyv husker valget for denne nettsiden">
                    Ignorer dette funnet
                  </button>
                </li>
              ))}
            </ul>
          )}
          {s === 'block' && (
            <label className="check finding-ack">
              <input type="checkbox" checked={acknowledged} onChange={(e) => onAcknowledge(e.target.checked)} />
              <span>Jeg vet hva jeg gjør, gi ut likevel</span>
            </label>
          )}
        </section>
      ))}
      {ignoredCount > 0 && (
        <button className="link-btn small-text" onClick={onShowIgnored}>
          {plural(ignoredCount, 'funn er ignorert', 'funn er ignorert')}. Vis igjen
        </button>
      )}
    </div>
  )
}

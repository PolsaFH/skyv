import type { KeyboardEvent } from 'react'
import type { SiteView } from '../../../core/types'

interface Props {
  sites: SiteView[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onAppSettings: () => void
}

function statusOf(site: SiteView): { cls: string; label: string } {
  if (!site.host || !site.hasPassword) return { cls: 'dot-idle', label: 'Ikke ferdig satt opp' }
  if (site.pendingCount > 0) return { cls: 'dot-pending', label: `${site.pendingCount} endringer venter` }
  return { cls: 'dot-ok', label: 'Alt er oppdatert' }
}

export function Sidebar({ sites, selectedId, onSelect, onAdd, onAppSettings }: Props) {
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const idx = sites.findIndex((s) => s.id === selectedId)
    const next = e.key === 'ArrowDown' ? Math.min(sites.length - 1, idx + 1) : Math.max(0, idx - 1)
    if (sites[next]) onSelect(sites[next].id)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <div className="sidebar-heading">Nettsider</div>
      <ul className="site-list" role="listbox" aria-label="Nettsider" tabIndex={0} onKeyDown={onKeyDown}>
        {sites.map((site) => {
          const status = statusOf(site)
          return (
            <li
              key={site.id}
              role="option"
              aria-selected={site.id === selectedId}
              className={`site-item ${site.id === selectedId ? 'selected' : ''}`}
              onClick={() => onSelect(site.id)}
              title={status.label}
            >
              <span className={`dot ${status.cls}`} aria-label={status.label} />
              <span className="site-name">{site.name}</span>
              {site.deviationCount > 0 && (
                <span className="dev-marker" title={`${site.deviationCount} avvik på serveren`} aria-label={`${site.deviationCount} avvik på serveren`}>
                  ⚠
                </span>
              )}
              {site.pendingCount > 0 && <span className="badge">{site.pendingCount}</span>}
            </li>
          )
        })}
      </ul>
      <div className="sidebar-foot">
        <button className="sidebar-add" onClick={onAdd}>
          <span aria-hidden>+</span> Ny nettside
        </button>
        <button className="sidebar-gear" onClick={onAppSettings} aria-label="Innstillinger for Skyv" title="Innstillinger for Skyv">
          ⚙
        </button>
      </div>
    </aside>
  )
}

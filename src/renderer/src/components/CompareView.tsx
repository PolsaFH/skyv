import { useCallback, useEffect, useRef, useState } from 'react'
import { api, friendlyError, type FriendlyError } from '../api'

interface Props {
  siteId: string
  siteName: string
  /** Page to show first, if any. */
  initialPath?: string
  onClose: () => void
}

type Info = Awaited<ReturnType<typeof api.preview.info>>
type Page = Awaited<ReturnType<typeof api.preview.pages>>[number]
type Shot = { state: 'loading' } | { state: 'ok'; dataUrl: string; height: number } | { state: 'error'; error: FriendlyError } | { state: 'off'; reason: string }

const WIDTHS = { desktop: { label: 'Datamaskin', px: 1280 }, mobile: { label: 'Mobil', px: 390 } } as const
type WidthKey = keyof typeof WIDTHS

const REASON = { changed: 'endret', 'uses-changed': 'bruker en endret fil', 'front-page': 'forsiden' } as const

/** The real site and the local version of a page, side by side or with a slider. */
export function CompareView({ siteId, siteName, initialPath, onClose }: Props) {
  const [info, setInfo] = useState<Info | null>(null)
  const [pages, setPages] = useState<Page[] | null>(null)
  const [path, setPath] = useState<string | null>(initialPath ?? null)
  const [width, setWidth] = useState<WidthKey>('desktop')
  const [mode, setMode] = useState<'side' | 'slider'>('side')
  const [live, setLive] = useState<Shot>({ state: 'loading' })
  const [local, setLocal] = useState<Shot>({ state: 'loading' })
  const [split, setSplit] = useState(50)
  const [error, setError] = useState<FriendlyError | null>(null)
  const sliderRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.all([api.preview.info(siteId), api.preview.pages(siteId)]).then(
      ([i, p]) => {
        setInfo(i)
        const list = initialPath && !p.some((x) => x.path === initialPath) ? [{ path: initialPath, reason: 'changed' as const }, ...p] : p
        setPages(list)
        setPath((cur) => cur ?? list[0]?.path ?? null)
      },
      (e) => setError(friendlyError(e))
    )
  }, [siteId, initialPath])

  const load = useCallback(async () => {
    if (!info || !path) return
    const px = WIDTHS[width].px
    const shoot = async (which: 'live' | 'local', set: (s: Shot) => void) => {
      if (which === 'live' && !info.live) return set({ state: 'off', reason: info.liveReason ?? '' })
      if (which === 'local' && info.local === 'unavailable') return set({ state: 'off', reason: info.localReason ?? '' })
      set({ state: 'loading' })
      try {
        const r = await api.preview.capture(siteId, path, which, px)
        set({ state: 'ok', ...r })
      } catch (e) {
        set({ state: 'error', error: friendlyError(e) })
      }
    }
    await Promise.all([shoot('live', setLive), shoot('local', setLocal)])
  }, [info, path, width, siteId])

  useEffect(() => {
    void load()
  }, [load])

  // Dragging the slider handle.
  const drag = (clientX: number) => {
    const el = sliderRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setSplit(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)))
  }

  const bothOk = live.state === 'ok' && local.state === 'ok'
  const frameWidth = width === 'mobile' ? 390 : undefined

  const renderShot = (s: Shot, label: string) => (
    <figure className="shot">
      <figcaption>{label}</figcaption>
      {s.state === 'loading' && <div className="shot-msg muted">Tar bilde av siden …</div>}
      {s.state === 'off' && <div className="shot-msg muted">{s.reason}</div>}
      {s.state === 'error' && (
        <div className="shot-msg notice notice-error">
          {s.error.message}
          {s.error.hint && <div className="muted">{s.error.hint}</div>}
        </div>
      )}
      {s.state === 'ok' && <img src={s.dataUrl} alt={label} style={frameWidth ? { width: frameWidth } : undefined} />}
    </figure>
  )

  return (
    <div className="compare-backdrop" role="dialog" aria-modal="true" aria-label="Før og etter">
      <div className="compare">
        <header className="compare-head">
          <div className="compare-title">
            <strong>Før og etter</strong>
            <span className="muted"> · {siteName}</span>
          </div>
          <select value={path ?? ''} onChange={(e) => setPath(e.target.value)} aria-label="Side" disabled={!pages || pages.length === 0}>
            {pages?.map((p) => (
              <option key={p.path} value={p.path}>
                {p.path} ({REASON[p.reason]}
                {p.via ? `: ${p.via}` : ''})
              </option>
            ))}
          </select>
          <div className="segmented" role="radiogroup" aria-label="Bredde">
            {(Object.keys(WIDTHS) as WidthKey[]).map((k) => (
              <button key={k} role="radio" aria-checked={width === k} className={width === k ? 'on' : ''} onClick={() => setWidth(k)}>
                {WIDTHS[k].label}
              </button>
            ))}
          </div>
          <div className="segmented" role="radiogroup" aria-label="Visning">
            <button role="radio" aria-checked={mode === 'side'} className={mode === 'side' ? 'on' : ''} onClick={() => setMode('side')}>
              Side ved side
            </button>
            <button role="radio" aria-checked={mode === 'slider'} className={mode === 'slider' ? 'on' : ''} onClick={() => setMode('slider')} disabled={!bothOk}>
              Glidebryter
            </button>
          </div>
          <span className="grow" />
          <button className="btn btn-small" onClick={() => void load()} disabled={!path}>
            Ta nye bilder
          </button>
          <button className="btn btn-small" onClick={onClose}>
            Lukk
          </button>
        </header>

        {error && <div className="notice notice-error">{error.message}</div>}
        {pages && pages.length === 0 && <div className="muted compare-empty">Ingen endrede sider å sammenligne.</div>}

        {path && mode === 'side' && (
          <div className="compare-body side">
            {renderShot(live, 'Nå på nettsiden')}
            {renderShot(local, 'Din versjon (på Macen)')}
          </div>
        )}

        {path && mode === 'slider' && live.state === 'ok' && local.state === 'ok' && (
          <div className="compare-body">
            <div className="slider-labels">
              <span>← Nå på nettsiden</span>
              <span>Din versjon →</span>
            </div>
            <div
              className="slider"
              ref={sliderRef}
              style={{ width: frameWidth ?? '100%', aspectRatio: `${WIDTHS[width].px} / ${Math.max(live.height, local.height)}` }}
              onPointerDown={(e) => {
                ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
                drag(e.clientX)
              }}
              onPointerMove={(e) => e.buttons === 1 && drag(e.clientX)}
            >
              <img src={local.dataUrl} alt="Din versjon" className="slider-img" />
              <img src={live.dataUrl} alt="Nå på nettsiden" className="slider-img slider-top" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
              <div className="slider-handle" style={{ left: `${split}%` }} />
            </div>
            <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Glidebryter mellom før og etter" className="slider-range" />
          </div>
        )}

        <footer className="compare-foot">
          <button className="btn btn-small" onClick={() => path && api.preview.open(siteId, path, 'local').catch((e) => setError(friendlyError(e)))} disabled={!path || info?.local === 'unavailable'}>
            Åpne lokal forhåndsvisning i nettleseren
          </button>
          <button className="btn btn-small" onClick={() => path && api.preview.open(siteId, path, 'live').catch((e) => setError(friendlyError(e)))} disabled={!path || !info?.live}>
            Åpne den ekte siden
          </button>
          {info?.local === 'php' && <span className="muted small-text">Den lokale versjonen kjøres med PHP på Macen.</span>}
        </footer>
      </div>
    </div>
  )
}

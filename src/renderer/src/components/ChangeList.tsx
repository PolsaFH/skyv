import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Change, ChangeSet } from '../../../core/api'
import { changeKey } from '../../../core/manifest/changes'
import type { SiteView } from '../../../core/types'
import { api, friendlyError, type FriendlyError } from '../api'
import { formatBytes, formatWhen, plural } from '../format'
import { DiffView } from './DiffView'
import { StartingPointPanel } from './StartingPointPanel'
import { FindingsPanel } from './FindingsPanel'
import type { Finding } from '../../../core/api'
import { ruleSummary } from '../../../core/summary/ruleSummary'
import { AiConsentDialog } from './AiConsentDialog'

interface Props {
  site: SiteView
  /** Increment to request a rescan (window focus, settings saved, …). */
  rescanToken: number
  onScanned: () => void
  /** Called with the selected changes when the user gives them out. */
  onRelease: (changes: Change[], acknowledgeBlocking: boolean, note: string) => void
  /** True while a release or undo runs for this site. */
  busy: boolean
  /** Open "før og etter" for a page. */
  onCompare: (path: string) => void
  /** Unhandled server deviations: shown as a yellow line above the release button (never blocks). */
  deviationCount?: number
  /** Selection and note from a draft prepared by AI ("Se gjennom"). The user can still change both. */
  preset?: { keys: string[]; note: string; token: number } | null
}

type Filter = 'all' | Change['kind']

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Alle' },
  { value: 'added', label: 'Nye' },
  { value: 'modified', label: 'Endret' },
  { value: 'renamed', label: 'Omdøpt' },
  { value: 'deleted', label: 'Slettet' }
]

const KIND = {
  added: { icon: '+', label: 'ny' },
  modified: { icon: '✎', label: 'endret' },
  renamed: { icon: '↻', label: 'omdøpt' },
  deleted: { icon: '−', label: 'slettet' }
} as const

const keyOf = changeKey

/**
 * Add files that selected files need (new images, stylesheets, includes …), transitively.
 * Only new files appear in `neededBy`, so this never selects a deletion.
 */
function withRequired(sel: Set<string>, cs: ChangeSet): Set<string> {
  const byPath = new Map(cs.changes.map((c) => [c.path, c]))
  const selectedPaths = () => new Set(cs.changes.filter((c) => sel.has(changeKey(c))).map((c) => c.path))
  let grew = true
  while (grew) {
    grew = false
    const paths = selectedPaths()
    for (const [needed, by] of Object.entries(cs.deps.neededBy)) {
      const c = byPath.get(needed)
      if (!c || sel.has(changeKey(c))) continue
      if (by.some((p) => paths.has(p))) {
        sel.add(changeKey(c))
        grew = true
      }
    }
  }
  return sel
}

function folderOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function ChangeList({ site, rescanToken, onScanned, onRelease, busy, onCompare, deviationCount = 0, preset }: Props) {
  const [cs, setCs] = useState<ChangeSet | null>(null)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<Change | null>(null)
  // Keys the user has already seen, so their choices survive a rescan.
  const known = useRef<Set<string>>(new Set())

  const applyChangeSet = useCallback((next: ChangeSet) => {
    setCs(next)
    setSelected((prev) => {
      const sel = new Set<string>()
      for (const c of next.changes) {
        const k = keyOf(c)
        if (known.current.has(k) ? prev.has(k) : c.kind !== 'deleted') sel.add(k)
      }
      known.current = new Set(next.changes.map(keyOf))
      return withRequired(sel, next)
    })
    setOpen((o) => (o && next.changes.some((c) => keyOf(c) === keyOf(o)) ? o : null))
  }, [])

  const scan = useCallback(async () => {
    setScanning(true)
    setError(null)
    try {
      applyChangeSet(await api.changes.scan(site.id))
      onScanned()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setScanning(false)
      setProgress(null)
    }
  }, [site.id, applyChangeSet, onScanned])

  useEffect(() => {
    known.current = new Set()
    void scan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, rescanToken])

  // The background watcher rescans after a burst of edits; show the result right away.
  useEffect(
    () =>
      api.app.onChangesUpdated((e) => {
        if (e.siteId === site.id) applyChangeSet(e.changeSet)
      }),
    [site.id, applyChangeSet]
  )

  useEffect(
    () =>
      api.changes.onProgress((e) => {
        if (e.siteId === site.id && e.kind === 'scan' && e.progress.phase === 'hashing') setProgress({ done: e.progress.done, total: e.progress.total })
      }),
    [site.id]
  )

  const visible = useMemo(() => {
    if (!cs) return []
    const q = query.trim().toLowerCase()
    return cs.changes.filter((c) => (filter === 'all' || c.kind === filter) && (!q || c.path.toLowerCase().includes(q) || c.from?.toLowerCase().includes(q)))
  }, [cs, query, filter])

  // Drawing thousands of rows makes the window slow; show them in portions.
  const [limit, setLimit] = useState(400)
  useEffect(() => setLimit(400), [site.id, query, filter])
  const shown = visible.length > limit ? visible.slice(0, limit) : visible

  const groups = useMemo(() => {
    const map = new Map<string, Change[]>()
    for (const c of shown) {
      const f = folderOf(c.path)
      map.set(f, [...(map.get(f) ?? []), c])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'nb'))
  }, [shown])

  const selectedChanges = cs?.changes.filter((c) => selected.has(keyOf(c))) ?? []

  // Work sessions, oldest first, so each gets a stable colour and a label like "Økt 14:32".
  const sessionOrder = useMemo(() => {
    const ends = [...new Set(Object.values(cs?.sessions ?? {}).map((s) => `${s.endedAt}|${s.id}`))].sort()
    return new Map(ends.map((e, i) => [e.split('|')[1], i]))
  }, [cs])
  const sessionLabel = (c: Change) => {
    const s = cs?.sessions?.[c.path]
    if (!s) return null
    const t = new Date(s.endedAt).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
    return { text: `Økt ${t}`, hue: ((sessionOrder.get(s.id) ?? 0) * 67) % 360 }
  }
  const selectedPaths = new Set(selectedChanges.map((c) => c.path))

  /** "Trengs av index.html" for new files that selected changes need. */
  const neededBy = (c: Change): string | null => {
    const by = cs?.deps.neededBy[c.path]
    if (!by || by.length === 0) return null
    const names = by.slice(0, 2).map((p) => p.slice(p.lastIndexOf('/') + 1)).join(', ')
    return `Trengs av ${names}${by.length > 2 ? ` og ${by.length - 2} til` : ''}`
  }
  const deletions = selectedChanges.filter((c) => c.kind === 'deleted').length

  const toggle = (c: Change) =>
    setSelected((prev) => {
      const next = new Set(prev)
      const k = keyOf(c)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return cs && !prev.has(k) ? withRequired(next, cs) : next
    })

  const toggleGroup = (items: Change[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const c of items) {
        // Group toggling never selects deletions; those must be chosen one by one.
        if (on && c.kind === 'deleted') continue
        if (on) next.add(keyOf(c))
        else next.delete(keyOf(c))
      }
      return on && cs ? withRequired(next, cs) : next
    })

  // Run the checks whenever the selection changes (debounced).
  const [findings, setFindings] = useState<Finding[]>([])
  const [ignoredCount, setIgnoredCount] = useState(0)
  const [checking, setChecking] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [checkToken, setCheckToken] = useState(0)
  const selectionKey = selectedChanges.map(keyOf).join('|')
  useEffect(() => {
    if (!cs || selectedChanges.length === 0) {
      setFindings([])
      return
    }
    let cancelled = false
    setChecking(true)
    const t = setTimeout(() => {
      api.checks
        .run(site.id, selectedChanges.map(keyOf))
        .then((r) => {
          if (cancelled) return
          setFindings(r.findings)
          setIgnoredCount(r.ignoredCount)
          if (!r.findings.some((f) => f.severity === 'block')) setAcknowledged(false)
        })
        .catch(() => undefined)
        .finally(() => !cancelled && setChecking(false))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, selectionKey, cs, checkToken])

  // Release note: a plain summary that follows the selection until the user edits it.
  const [note, setNote] = useState('')
  const [noteEdited, setNoteEdited] = useState(false)
  const [ai, setAi] = useState<{ enabled: boolean; consent: boolean; hasKey: boolean }>({ enabled: false, consent: false, hasKey: false })
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [consent, setConsent] = useState<null | 'ask' | 'show'>(null)
  useEffect(() => {
    if (!noteEdited) setNote(selectedChanges.length > 0 ? ruleSummary(selectedChanges) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, noteEdited])
  useEffect(() => {
    Promise.all([api.app.getSettings(), api.summary.hasKey()]).then(
      ([s, hasKey]) => setAi({ enabled: s.aiSummaries, consent: s.aiConsentGiven, hasKey }),
      () => undefined
    )
    // rescanToken also changes when the app settings are closed, so a new choice shows up right away.
  }, [site.id, rescanToken])
  const writeWithAi = async () => {
    setAiBusy(true)
    setAiError(null)
    try {
      setNote(await api.summary.write(site.id, selectedChanges.map(keyOf)))
      setNoteEdited(true)
    } catch (e) {
      setAiError(friendlyError(e).message)
    } finally {
      setAiBusy(false)
    }
  }

  // "Se gjennom" on an AI draft: select exactly the draft's files and use its note.
  useEffect(() => {
    if (!preset) return
    setSelected(new Set(preset.keys))
    setNote(preset.note)
    setNoteEdited(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.token])

  const hasBlocking = findings.some((f) => f.severity === 'block')
  const blockedNow = (hasBlocking && !acknowledged) || checking

  const release = useCallback(() => {
    if (busy || selectedChanges.length === 0 || blockedNow) return
    onRelease(selectedChanges, acknowledged, note)
    setNoteEdited(false)
  }, [busy, selectedChanges, onRelease, blockedNow, acknowledged, note])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'Enter') {
        e.preventDefault()
        release()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [release])

  const counts = useMemo(() => {
    const c = { all: 0, added: 0, modified: 0, renamed: 0, deleted: 0 }
    for (const ch of cs?.changes ?? []) {
      c.all++
      c[ch.kind]++
    }
    return c
  }, [cs])

  if (error && !cs) {
    return (
      <div className="notice notice-error">
        <strong>{error.message}</strong>
        {error.hint && <div>{error.hint}</div>}
        <div>
          <button className="btn" onClick={scan}>
            Prøv igjen
          </button>
        </div>
      </div>
    )
  }

  if (!cs) {
    return (
      <div className="scan-status muted">
        Ser etter endringer …{progress && progress.total > 0 ? ` ${progress.done} av ${progress.total} filer` : ''}
        {progress && progress.total > 0 && <progress value={progress.done} max={progress.total} />}
      </div>
    )
  }

  if (cs.needsStartingPoint || cs.needsCompare) {
    return <StartingPointPanel siteId={site.id} changeSet={cs} onDone={(next) => (next ? applyChangeSet(next) : void scan())} />
  }

  const total = cs.changes.length

  return (
    <div className={`changes ${open ? 'with-diff' : ''}`}>
      <div className="changes-main">
        <div className="changes-head">
          <div>
            <h2 className="changes-title">{total === 0 ? 'Alt er oppdatert' : plural(total, 'endring', 'endringer') + ' siden forrige utgivelse'}</h2>
            {cs.lastPublishedAt && total > 0 && <small className="muted">Forrige utgivelse: {formatWhen(cs.lastPublishedAt)}</small>}
          </div>
          <button className="btn btn-small" onClick={scan} disabled={scanning} title="Se etter endringer på nytt">
            {scanning ? 'Ser etter …' : 'Oppdater'}
          </button>
        </div>

        {cs.warnings.length > 0 && (
          <details className="notice notice-warn">
            <summary>{plural(cs.warnings.length, 'fil ble', 'filer ble')} hoppet over</summary>
            <ul className="plain">
              {cs.warnings.slice(0, 20).map((w) => (
                <li key={w.path}>
                  <span className="mono">{w.path}</span>: {w.message}
                </li>
              ))}
            </ul>
          </details>
        )}

        {total === 0 ? (
          <div className="empty small">
            <div className="empty-check" aria-hidden>
              ✓
            </div>
            <p>
              Alt er oppdatert.{cs.lastPublishedAt ? ` Siste utgivelse var ${formatWhen(cs.lastPublishedAt)}.` : ''}
            </p>
            <small className="muted">
              {plural(cs.fileCount, 'fil', 'filer')} i mappen
              {cs.ignoredCount > 0 ? `, ${plural(cs.ignoredCount, 'ignorert', 'ignorert')}` : ''}.
            </small>
          </div>
        ) : (
          <>
            <div className="changes-tools">
              <input className="search" type="search" placeholder="Søk etter fil" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Søk etter fil" />
              <div className="segmented" role="tablist" aria-label="Vis">
                {FILTERS.filter((f) => f.value === 'all' || counts[f.value] > 0).map((f) => (
                  <button key={f.value} role="tab" aria-selected={filter === f.value} className={filter === f.value ? 'on' : ''} onClick={() => setFilter(f.value)}>
                    {f.label} <span className="seg-count">{counts[f.value]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="change-groups">
              {groups.length === 0 && <div className="muted diff-pad">Ingen filer passer søket.</div>}
              {visible.length > shown.length && (
                <div className="show-more">
                  Viser {shown.length} av {visible.length}.{' '}
                  <button className="link-btn" onClick={() => setLimit((l) => l + 1000)}>
                    Vis flere
                  </button>{' '}
                  <span className="muted">Alle er med i utgivelsen selv om de ikke vises.</span>
                </div>
              )}
              {groups.map(([folder, items]) => {
                const allOn = items.filter((c) => c.kind !== 'deleted').every((c) => selected.has(keyOf(c)))
                return (
                  <section key={folder} className="change-group">
                    <header className="group-head">
                      <input
                        type="checkbox"
                        checked={allOn && items.some((c) => c.kind !== 'deleted')}
                        onChange={(e) => toggleGroup(items, e.target.checked)}
                        aria-label={`Velg alle i ${folder || 'hovedmappen'}`}
                        disabled={items.every((c) => c.kind === 'deleted')}
                      />
                      <span>{folder ? `${folder}/` : 'Hovedmappen'}</span>
                      <span className="muted">{items.length}</span>
                    </header>
                    <ul className="change-rows">
                      {items.map((c) => {
                        const k = keyOf(c)
                        return (
                          <li key={k} className={`change-row kind-${c.kind} ${open && keyOf(open) === k ? 'active' : ''}`}>
                            <input type="checkbox" checked={selected.has(k)} onChange={() => toggle(c)} aria-label={`Ta med ${c.path}`} />
                            <button className="change-main" onClick={() => setOpen(c)} title="Vis forskjellen">
                              <span className={`kind-icon kind-${c.kind}`} aria-hidden>
                                {KIND[c.kind].icon}
                              </span>
                              <span className="change-name">
                                {nameOf(c.path)}
                                {c.kind === 'renamed' && c.from && <small className="muted"> fra {c.from}</small>}
                              </span>
                              {sessionLabel(c) && (
                                <span className="session-tag" style={{ ['--hue' as string]: sessionLabel(c)!.hue }} title="Endret i denne økten">
                                  {sessionLabel(c)!.text}
                                </span>
                              )}
                              {neededBy(c) && (
                                <span
                                  className={`needed-tag ${!selected.has(k) && cs.deps.neededBy[c.path].some((p) => selectedPaths.has(p)) ? 'needed-warn' : ''}`}
                                  title={cs.deps.neededBy[c.path].join(', ')}
                                >
                                  {neededBy(c)}
                                </span>
                              )}
                              <span className={`change-kind kind-${c.kind}`}>{KIND[c.kind].label}</span>
                              <span className="change-size muted">{c.kind === 'deleted' ? '' : formatBytes(c.size)}</span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
            </div>
          </>
        )}

        {total > 0 && selectedChanges.length > 0 && (
          <FindingsPanel
            findings={findings}
            ignoredCount={ignoredCount}
            loading={checking}
            acknowledged={acknowledged}
            onAcknowledge={setAcknowledged}
            onIgnore={async (f) => {
              await api.checks.ignore(site.id, f.key)
              setFindings((list) => list.filter((x) => x.key !== f.key))
              setIgnoredCount((n) => n + 1)
            }}
            onShowIgnored={async () => {
              await api.checks.clearIgnored(site.id)
              setCheckToken((t) => t + 1)
            }}
            onOpenFile={(path) => {
              const c = cs.changes.find((x) => x.path === path)
              if (c) setOpen(c)
            }}
          />
        )}

        {total > 0 && selectedChanges.length > 0 && (
          <div className="note-box">
            <label className="note-label" htmlFor="release-note">
              Notat for utgivelsen
            </label>
            <textarea
              id="release-note"
              rows={2}
              value={note}
              onChange={(e) => {
                setNote(e.target.value)
                setNoteEdited(true)
              }}
            />
            <div className="note-actions">
              {noteEdited && (
                <button className="link-btn small-text" onClick={() => setNoteEdited(false)}>
                  Bruk vanlig sammendrag
                </button>
              )}
              {ai.enabled && ai.hasKey && (
                <>
                  <button className="btn btn-small" disabled={aiBusy} onClick={() => (ai.consent ? void writeWithAi() : setConsent('ask'))}>
                    {aiBusy ? 'Skriver …' : 'Skriv med AI'}
                  </button>
                  {ai.consent && (
                    <button className="link-btn small-text" onClick={() => setConsent('show')}>
                      Vis hva som sendes
                    </button>
                  )}
                </>
              )}
              {aiError && <span className="error-text small-text">{aiError}</span>}
            </div>
          </div>
        )}
        {consent && (
          <AiConsentDialog
            siteId={site.id}
            keys={selectedChanges.map(keyOf)}
            firstTime={consent === 'ask'}
            onCancel={() => setConsent(null)}
            onAccept={async () => {
              setConsent(null)
              await api.app.setSettings({ aiConsentGiven: true })
              setAi((a) => ({ ...a, consent: true }))
              await writeWithAi()
            }}
          />
        )}

        {total > 0 && (
          <div className="release-bar">
            {deviationCount > 0 && deletions === 0 && (
              <div className="deviation-line">⚠ {deviationCount === 1 ? '1 avvik på serveren er' : `${deviationCount} avvik på serveren er`} ikke behandlet</div>
            )}
            {deletions > 0 && (
              <div className="release-note danger-text">
                {plural(deletions, 'fil blir slettet', 'filer blir slettet')} fra serveren.
              </div>
            )}
            <button
              className={`btn btn-release ${hasBlocking ? 'btn-danger' : 'btn-primary'}`}
              disabled={busy || selectedChanges.length === 0 || blockedNow}
              onClick={release}
              title={hasBlocking && !acknowledged ? 'Se funnene over først' : undefined}
            >
              Gi ut {plural(selectedChanges.length, 'endring', 'endringer')}
            </button>
            <small className="muted">⌘ Enter</small>
          </div>
        )}
      </div>

      {open && (
        <aside className="changes-diff">
          <DiffView siteId={site.id} change={open} onClose={() => setOpen(null)} onCompare={onCompare} />
        </aside>
      )}
    </div>
  )
}

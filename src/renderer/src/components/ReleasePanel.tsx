import { useEffect, useMemo, useState } from 'react'
import type { Release, ReleaseProgress } from '../../../core/api'
import { api } from '../api'
import { formatBytes, plural } from '../format'
import { PostCheckView } from './PostCheckView'

export interface RunningRelease {
  /** Files in the order they were sent. */
  paths: string[]
  /** Set when finished. */
  result?: Release
  error?: { message: string; hint?: string }
}

interface Props {
  siteId: string
  running: RunningRelease
  onRetry: (releaseId: string) => void
  onUndo: (release: Release) => void
  /** Undo immediately, without a confirmation dialog (used from the red check alert). */
  onUndoNow: (release: Release) => void
  onRecheck: (releaseId: string) => void
  onClose: () => void
}

type FileState = { state: string; bytes?: number; size?: number; error?: string }

const STATE_LABEL: Record<string, string> = {
  pending: 'Venter',
  uploading: 'Laster opp',
  done: 'Ferdig',
  failed: 'Feilet',
  skipped: 'Hoppet over'
}

/** Shows progress while a release runs, and the result afterwards. */
export function ReleasePanel({ siteId, running, onRetry, onUndo, onUndoNow, onRecheck, onClose }: Props) {
  const [files, setFiles] = useState<Record<string, FileState>>({})
  const [overall, setOverall] = useState<Pick<ReleaseProgress, 'phase' | 'doneCount' | 'totalCount' | 'doneBytes' | 'totalBytes'> | null>(null)

  useEffect(
    () =>
      api.changes.onProgress((e) => {
        if (e.siteId !== siteId || e.kind !== 'release') return
        const p = e.progress
        setOverall({ phase: p.phase, doneCount: p.doneCount, totalCount: p.totalCount, doneBytes: p.doneBytes, totalBytes: p.totalBytes })
        if (p.items.length === 0) return
        setFiles((prev) => {
          const next = { ...prev }
          for (const it of p.items) next[it.path] = { ...next[it.path], ...it }
          return next
        })
      }),
    [siteId]
  )

  const result = running.result
  const failed = result?.items.filter((i) => i.state === 'failed') ?? []
  const done = result?.items.filter((i) => i.state === 'done') ?? []

  const inFlightBytes = useMemo(
    () => Object.values(files).reduce((n, f) => n + (f.state === 'uploading' ? (f.bytes ?? 0) : 0), 0),
    [files]
  )
  const pct = overall && overall.totalBytes > 0 ? Math.min(100, ((overall.doneBytes + inFlightBytes) / overall.totalBytes) * 100) : overall && overall.totalCount > 0 ? (overall.doneCount / overall.totalCount) * 100 : 0

  const list = result ? result.items.map((i) => i.path) : running.paths

  let title: string
  if (running.error) title = 'Utgivelsen kunne ikke starte'
  else if (!result)
    title =
      overall?.phase === 'verify'
        ? 'Sjekker nettsiden …'
        : overall?.phase === 'snapshot' || !overall
          ? 'Tar sikkerhetskopi av det som blir erstattet …'
          : `Gir ut ${plural(running.paths.length, 'endring', 'endringer')} …`
  else if (result.status === 'undone') title = 'Utgivelsen er angret'
  else if (result.check && !result.check.ok && !result.check.skipped) title = 'Utgivelsen er ute, men noe ser feil ut'
  else if (result.status === 'success') title = 'Utgivelsen er ferdig'
  else if (result.status === 'partial') title = `${plural(failed.length, 'fil', 'filer')} kom ikke ut`
  else title = 'Utgivelsen mislyktes'

  return (
    <div className="release-panel card" aria-live="polite">
      <div className="release-head">
        <h2 className={result && result.status !== 'success' ? 'danger-text' : ''}>{title}</h2>
        {result || running.error ? (
          <button className="btn btn-small" onClick={onClose}>
            Lukk
          </button>
        ) : null}
      </div>

      {running.error && (
        <div className="notice notice-error">
          {running.error.message}
          {running.error.hint && <div>{running.error.hint}</div>}
        </div>
      )}

      {!result && !running.error && (
        <>
          <progress className="release-progress" value={pct} max={100} aria-label="Fremdrift" />
          <small className="muted">
            {overall ? `${overall.doneCount} av ${overall.totalCount} filer` : 'Kobler til …'}
            {overall && overall.totalBytes > 0 ? ` · ${formatBytes(overall.doneBytes + inFlightBytes)} av ${formatBytes(overall.totalBytes)}` : ''}
          </small>
        </>
      )}

      {result && result.status === 'success' && !result.check && (
        <p className="lead">{plural(done.length, 'endring er', 'endringer er')} ute på nettsiden. Du kan angre hele utgivelsen hvis noe ser feil ut.</p>
      )}
      {result?.check && (
        <PostCheckView
          check={result.check}
          onUndo={() => onUndoNow(result)}
          onRecheck={() => onRecheck(result.id)}
        />
      )}
      {result && failed.length > 0 && (
        <p className="lead">
          {done.length > 0 ? `${plural(done.length, 'fil', 'filer')} kom ut. ` : ''}De som feilet er listet under. Ingenting er ødelagt på serveren: filene som feilet ble aldri lagt på plass.
        </p>
      )}

      <ul className="release-files">
        {list.map((path) => {
          const item = result?.items.find((i) => i.path === path)
          const live = files[path]
          const state = item?.state ?? live?.state ?? 'pending'
          const pctFile = live?.state === 'uploading' && live.size ? Math.round(((live.bytes ?? 0) / live.size) * 100) : null
          return (
            <li key={path} className={`release-file state-${state}`}>
              <span className="release-icon" aria-hidden>
                {state === 'done' ? '✓' : state === 'failed' ? '✕' : state === 'uploading' ? '↑' : '·'}
              </span>
              <span className="mono release-path">{path}</span>
              <span className="release-state">
                {pctFile !== null ? `${pctFile} %` : STATE_LABEL[state] ?? state}
              </span>
              {state === 'failed' && (item?.error || live?.error) && (
                <div className="release-error">
                  {item?.error ?? live?.error}
                  {item?.hint && <span className="muted"> {item.hint}</span>}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {result && (
        <div className="release-actions">
          {failed.length > 0 && result.snapshot === 'kept' && (
            <button className="btn btn-primary" onClick={() => onRetry(result.id)}>
              Prøv igjen
            </button>
          )}
          {done.length > 0 && result.status !== 'undone' && (!result.check || result.check.ok || result.check.skipped) && (
            <button className="btn" onClick={() => onUndo(result)}>
              Angre utgivelsen
            </button>
          )}
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SiteView } from '../../../core/types'
import type { Change, InterruptedRelease, Release } from '../../../core/api'
import { changeKey } from '../../../core/manifest/changes'
import { api, friendlyError, type FriendlyError } from '../api'
import { ConfirmDialog } from './ConfirmDialog'
import { ChangeList } from './ChangeList'
import { ReleasePanel, type RunningRelease } from './ReleasePanel'
import { HistoryPanel } from './HistoryPanel'
import { UndoDialog } from './UndoDialog'
import { ConflictDialog } from './ConflictDialog'
import { CompareView } from './CompareView'
import { LogDialog } from './LogDialog'
import { ServerDeviations } from './ServerDeviations'
import { DraftBand } from './DraftBand'
import type { Draft, UndoRequest } from '../../../core/api'
import type { ServerCheckResult } from '../../../core/api'

const AUTO_CHECK_AFTER_MS = 5 * 60 * 1000
import type { Conflict } from '../../../core/api'
import { formatWhen, plural } from '../format'

interface Props {
  site: SiteView
  onEdit: () => void
  onError: (e: FriendlyError) => void
  rescanToken: number
  onScanned: () => void
}

const PROTOCOL_LABEL = { ftp: 'FTP', ftps: 'FTP med kryptering (FTPS)', sftp: 'SFTP' } as const

export function SiteDetail({ site, onEdit, onError, rescanToken, onScanned }: Props) {
  const setupMissing = !site.host || !site.username || !site.hasPassword
  const [copied, setCopied] = useState(false)
  const [running, setRunning] = useState<RunningRelease | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDeletes, setConfirmDeletes] = useState<Change[] | null>(null)
  const [conflicts, setConflicts] = useState<{ changes: Change[]; list: Conflict[] } | null>(null)
  const [checking, setChecking] = useState(false)
  const [undo, setUndo] = useState<{ release: Release; paths?: string[]; fromRequest?: string } | null>(null)
  const [historyToken, setHistoryToken] = useState(0)
  const [localRescan, setLocalRescan] = useState(0)
  const [interrupted, setInterrupted] = useState<InterruptedRelease | null>(null)
  const [compare, setCompare] = useState<{ path?: string } | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [serverResult, setServerResult] = useState<ServerCheckResult | null>(null)
  const [serverChecking, setServerChecking] = useState(false)
  const [serverError, setServerError] = useState<FriendlyError | null>(null)
  const [serverNote, setServerNote] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [undoRequest, setUndoRequest] = useState<UndoRequest | null>(null)
  const [undoRequestRelease, setUndoRequestRelease] = useState<Release | null>(null)
  const [draftProblems, setDraftProblems] = useState<string[] | null>(null)
  const [preset, setPreset] = useState<{ keys: string[]; note: string; token: number } | null>(null)
  const activeDraft = useRef<string | null>(null)

  const loadDrafts = useCallback(async () => {
    const { drafts, undoRequests } = await api.drafts.list(site.id).catch(() => ({ drafts: [], undoRequests: [] }))
    const d = drafts[drafts.length - 1] ?? null
    setDraft(d)
    if (!d) {
      setDraftProblems(null)
      setPreset(null)
    }
    const u = undoRequests[undoRequests.length - 1] ?? null
    setUndoRequest(u)
    setUndoRequestRelease(u ? ((await api.releases.list(site.id).catch(() => [])).find((r) => r.id === u.releaseId) ?? null) : null)
  }, [site.id])

  useEffect(() => {
    void loadDrafts()
    return api.drafts.onUpdated((e) => {
      if (e.siteId === site.id) void loadDrafts()
    })
  }, [site.id, loadDrafts])

  const checkServer = useCallback(
    async (auto = false) => {
      setServerChecking(true)
      setServerError(null)
      try {
        setServerResult(await api.serverCheck.run(site.id))
      } catch (e) {
        // An automatic check that cannot run (no starting point yet, offline …) stays quiet.
        if (!auto) setServerError(friendlyError(e))
      } finally {
        setServerChecking(false)
      }
    },
    [site.id]
  )

  // Show the last result, and check automatically when it is older than 5 minutes.
  useEffect(() => {
    let cancelled = false
    setServerResult(null)
    setServerError(null)
    setServerNote(null)
    if (setupMissing) return
    api.serverCheck.last(site.id).then((last) => {
      if (cancelled) return
      setServerResult(last)
      if (!last || Date.now() - Date.parse(last.checkedAt) > AUTO_CHECK_AFTER_MS) void checkServer(true)
    }, () => undefined)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, setupMissing])

  useEffect(
    () =>
      api.serverCheck.onUpdated((e) => {
        if (e.siteId === site.id) setServerResult(e.result)
      }),
    [site.id]
  )


  useEffect(() => {
    api.releases.interrupted().then((list) => setInterrupted(list.find((i) => i.siteId === site.id) ?? null), () => undefined)
  }, [site.id, historyToken])

  const afterOperation = useCallback(() => {
    setHistoryToken((t) => t + 1)
    setLocalRescan((t) => t + 1)
    // Update the counts in the sidebar right away.
    onScanned()
  }, [onScanned])

  const run = useCallback(
    async (paths: string[], start: () => Promise<Release>) => {
      setBusy(true)
      setRunning({ paths })
      try {
        const result = await start()
        setRunning({ paths, result })
        if (activeDraft.current && result.items.some((i) => i.state === 'done') && result.status !== 'undone') {
          await api.drafts.markReleased(site.id, activeDraft.current, result.id).catch(() => undefined)
          activeDraft.current = null
          setPreset(null)
        }
      } catch (e) {
        setRunning({ paths, error: friendlyError(e) })
      } finally {
        setBusy(false)
        afterOperation()
      }
    },
    [afterOperation, site.id]
  )

  const ack = useRef(false)
  const noteRef = useRef('')
  const publish = useCallback(
    (changes: Change[]) =>
      run(
        changes.map((c) => c.path),
        () => api.releases.publish(site.id, changes.map(changeKey), noteRef.current, ack.current)
      ),
    [run, site.id]
  )

  const confirmAndPublish = (changes: Change[]) => {
    if (changes.length === 0) return
    // Deleting on the server always needs an explicit confirmation with the list of files.
    if (changes.some((c) => c.kind === 'deleted')) setConfirmDeletes(changes)
    else void publish(changes)
  }

  const requestRelease = async (changes: Change[], acknowledgeBlocking: boolean, note: string) => {
    ack.current = acknowledgeBlocking
    noteRef.current = note
    // First: has anyone changed these files on the server since the last release?
    setChecking(true)
    try {
      const list = await api.releases.check(site.id, changes.map(changeKey))
      if (list.length > 0) setConflicts({ changes, list })
      else confirmAndPublish(changes)
    } catch (e) {
      onError(friendlyError(e))
    } finally {
      setChecking(false)
    }
  }

  const retry = (releaseId: string) => run(running?.result?.items.filter((i) => i.state === 'failed').map((i) => i.path) ?? [], () => api.releases.retry(site.id, releaseId))

  const reviewDraft = () => {
    if (!draft) return
    activeDraft.current = draft.id
    setPreset({ keys: draft.files.map((f) => f.key), note: draft.note, token: Date.now() })
  }

  const releaseDraft = async () => {
    if (!draft) return
    setDraftProblems(null)
    try {
      const v = await api.drafts.validate(site.id, draft.id)
      if (!v.ok) {
        // Something changed or a check stops it: show why and open the review with fresh checks.
        setDraftProblems(v.problems)
        reviewDraft()
        return
      }
      const cs = await api.changes.last(site.id)
      const changes = (cs?.changes ?? []).filter((c) => v.keys.includes(changeKey(c)))
      activeDraft.current = draft.id
      await requestRelease(changes, false, draft.note)
    } catch (e) {
      onError(friendlyError(e))
    }
  }

  const copyUrl = async () => {
    if (!site.url) return
    await navigator.clipboard.writeText(site.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="detail">
      <header className="detail-header">
        <div>
          <h1>{site.name}</h1>
          <div className="muted path" title={site.localPath}>
            {site.host ? `${PROTOCOL_LABEL[site.protocol]} til ${site.host}${site.remoteRoot}` : 'Ikke koblet til et webhotell ennå'}
          </div>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={() => api.shell.showSiteFolder(site.id).catch((e) => onError(friendlyError(e)))} disabled={!site.localPath}>
            Vis i Finder
          </button>
          <button className="btn" onClick={() => api.shell.openSiteUrl(site.id).catch((e) => onError(friendlyError(e)))} disabled={!site.url}>
            Åpne nettsiden
          </button>
          <button className="btn" onClick={copyUrl} disabled={!site.url}>
            {copied ? 'Kopiert' : 'Kopiér lenke'}
          </button>
          <button className="btn" onClick={() => setCompare({})} disabled={setupMissing || site.pendingCount === 0} title="Se den ekte siden og din versjon ved siden av hverandre">
            Før og etter
          </button>
          <button className="btn" onClick={() => setShowLog(true)}>
            Vis logg
          </button>
          <button className="btn" onClick={onEdit}>
            Innstillinger
          </button>
        </div>
      </header>

      {setupMissing && (
        <div className="notice notice-info">
          <strong>Nesten klar.</strong> Legg inn opplysningene fra webhotellet (vert, brukernavn og passord) for å kunne gi ut endringer.
          <div>
            <button className="btn btn-primary" onClick={onEdit}>
              Legg inn opplysninger
            </button>
          </div>
        </div>
      )}

      {interrupted && !busy && (
        <div className="notice notice-warn" role="alert">
          <strong>{interrupted.kind === 'release' ? 'En utgivelse ble avbrutt' : 'Angringen ble avbrutt'} ({formatWhen(interrupted.startedAt)}).</strong>
          <div>Skyv ble lukket før den var ferdig. Velg hva som skal skje med det som allerede er gjort.</div>
          <div className="choice-buttons">
            {interrupted.kind === 'release' ? (
              <>
                <button className="btn btn-primary" onClick={() => run([], () => api.releases.retry(site.id, interrupted.releaseId))}>
                  Fullfør utgivelsen
                </button>
                <button
                  className="btn"
                  onClick={async () => {
                    const r = (await api.releases.list(site.id)).find((x) => x.id === interrupted.releaseId)
                    if (r) setUndo({ release: r })
                  }}
                >
                  Angre det som ble gjort
                </button>
              </>
            ) : (
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const r = (await api.releases.list(site.id)).find((x) => x.id === interrupted.releaseId)
                  if (r) setUndo({ release: r })
                }}
              >
                Angre på nytt
              </button>
            )}
            <button
              className="btn"
              onClick={() => api.releases.dismissInterrupted(site.id).then(() => setInterrupted(null))}
            >
              Ikke gjør noe
            </button>
          </div>
        </div>
      )}

      {!setupMissing && !running && (
        <DraftBand
          draft={draft}
          undoRequest={undoRequest}
          undoRelease={undoRequestRelease}
          problems={draftProblems}
          busy={busy || checking}
          reviewing={Boolean(preset)}
          onReview={reviewDraft}
          onRelease={() => void releaseDraft()}
          onDiscard={() => {
            if (draft) void api.drafts.discard(site.id, draft.id).then(loadDrafts)
            activeDraft.current = null
            setPreset(null)
          }}
          onUndoReview={() => undoRequestRelease && setUndo({ release: undoRequestRelease, fromRequest: undoRequest?.id })}
          onUndoReject={() => undoRequest && void api.drafts.closeUndoRequest(site.id, undoRequest.id, 'rejected').then(loadDrafts)}
        />
      )}

      {!setupMissing && !running && (
        <ServerDeviations
          siteId={site.id}
          result={serverResult}
          checking={serverChecking}
          error={serverError}
          busy={busy}
          onCheck={() => void checkServer(false)}
          onReupload={(path) =>
            void run([path], async () => {
              const r = await api.serverCheck.resolve(site.id, path, 'reupload')
              if (r.result) setServerResult(r.result)
              if (!r.release) throw new Error('Ingen utgivelse')
              return r.release
            })
          }
          onResolved={(result, message) => {
            if (result) setServerResult(result)
            setServerNote(message)
            afterOperation()
          }}
        />
      )}
      {serverNote && !running && (
        <div className="small-text muted server-note" role="status">
          {serverNote}{' '}
          <button className="link-btn" onClick={() => setServerNote(null)}>
            Skjul
          </button>
        </div>
      )}

      {running ? (
        <ReleasePanel
          siteId={site.id}
          running={running}
          onRetry={(id) => void retry(id)}
          onUndo={(release) => setUndo({ release })}
          onUndoNow={(release) => void run(running.paths, () => api.releases.undo(site.id, release.id))}
          onRecheck={(id) => void run(running.paths, () => api.releases.recheck(site.id, id))}
          onClose={() => setRunning(null)}
        />
      ) : (
        !setupMissing && (
          <ChangeList site={site} rescanToken={rescanToken + localRescan} onScanned={onScanned} onCompare={(path) => setCompare({ path })} onRelease={(c, a, n) => void requestRelease(c, a, n)} deviationCount={serverResult?.deviations.length ?? 0} preset={preset} busy={busy || checking || Boolean(interrupted)} />
        )
      )}

      {!setupMissing && <HistoryPanel siteId={site.id} refreshToken={historyToken} busy={busy} onUndo={(release, paths) => setUndo({ release, paths })} />}

      {confirmDeletes && (
        <ConfirmDialog
          title={`Slette ${plural(confirmDeletes.filter((c) => c.kind === 'deleted').length, 'fil', 'filer')} fra serveren?`}
          confirmLabel="Gi ut og slett"
          danger
          onCancel={() => setConfirmDeletes(null)}
          onConfirm={() => {
            const changes = confirmDeletes
            setConfirmDeletes(null)
            void publish(changes)
          }}
        >
          <p>Disse filene finnes ikke lenger på Macen og blir slettet fra nettsiden:</p>
          <ul className="plain mono-list">
            {confirmDeletes
              .filter((c) => c.kind === 'deleted')
              .map((c) => (
                <li key={c.path} className="mono danger-text">
                  {c.path}
                </li>
              ))}
          </ul>
          <p className="muted">Skyv tar sikkerhetskopi først, så du kan angre.</p>
          {confirmDeletes.some((c) => c.kind !== 'deleted') && (
            <p className="muted">{plural(confirmDeletes.filter((c) => c.kind !== 'deleted').length, 'annen endring', 'andre endringer')} blir også gitt ut.</p>
          )}
        </ConfirmDialog>
      )}

      {conflicts && (
        <ConflictDialog
          siteId={site.id}
          conflicts={conflicts.list}
          otherCount={conflicts.changes.filter((c) => !conflicts.list.some((x) => x.path === c.path || x.path === c.from)).length}
          onCancel={() => setConflicts(null)}
          onContinue={(skip) => {
            const skipSet = new Set(skip)
            // A rename touches two paths; skip it if either is skipped.
            const remaining = conflicts.changes.filter((c) => !skipSet.has(c.path) && !(c.from && skipSet.has(c.from)))
            setConflicts(null)
            confirmAndPublish(remaining)
          }}
        />
      )}

      {showLog && <LogDialog siteId={site.id} siteName={site.name} onClose={() => setShowLog(false)} />}
      {compare && <CompareView siteId={site.id} siteName={site.name} initialPath={compare.path} onClose={() => setCompare(null)} />}

      {undo && (
        <UndoDialog
          siteId={site.id}
          release={undo.release}
          paths={undo.paths}
          onCancel={() => setUndo(null)}
          onDone={() => {
            if (undo.fromRequest) void api.drafts.closeUndoRequest(site.id, undo.fromRequest, 'done').then(loadDrafts)
            setUndo(null)
            setRunning(null)
            setInterrupted(null)
            afterOperation()
          }}
        />
      )}
    </div>
  )
}

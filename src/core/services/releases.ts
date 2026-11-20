import type { SiteService } from '../sites/siteService'
import type { Workspaces } from './workspaces'
import { Publisher } from '../release/publisher'
import { undoRelease, planUndo, type UndoStep } from '../release/undo'
import { ReleaseStore, SnapshotStore, Journal } from '../release/stores'
import type { Release, ReleaseProgress } from '../release/types'
import { DiffStore } from '../release/diffStore'
import { fileHistory, releaseChanges, compareReleases, type FileChangeView, type FileHistoryEntry, type ReleaseComparison } from '../release/history'
import { changeKey } from '../manifest/changes'
import { UserError } from '../errors'
import type { QuickReleaseResult } from '../api'
import { findConflicts, type Conflict } from '../release/conflicts'
import { joinRemote } from '../remote/paths'
import type { DiffResult } from '../workspace'
import type { ChecksService } from './checks'
import { verifyRelease } from '../verify/verifyRelease'
import { createFetcher } from '../verify/fetcher'
import { HealthCheckStore } from '../verify/healthStore'
import type { Logs } from './logs'
import { formatStatus } from '../log/describe'

export interface InterruptedRelease {
  siteId: string
  siteName: string
  releaseId: string
  kind: 'release' | 'undo'
  startedAt: string
}

/** Runs releases and undo for each site, one operation per site at a time. */
export class ReleaseService {
  private busy = new Set<string>()
  /** Paths with unhandled server deviations (set by the server check service). */
  deviationPaths: (siteId: string) => Promise<string[]> = async () => []

  constructor(
    private readonly sites: SiteService,
    private readonly workspaces: Workspaces,
    private readonly checks: ChecksService,
    private readonly onProgress: (p: ReleaseProgress) => void,
    private readonly logs: Logs
  ) {}

  private async logRelease(siteId: string, release: Release, retry = false): Promise<void> {
    const log = this.logs.for(siteId)
    const details = release.items.map((i) =>
      i.state === 'done' ? `✓ ${i.path}${i.from ? ` (fra ${i.from})` : ''}` : i.state === 'failed' ? `✗ ${i.path}: ${i.error ?? 'feilet'}` : `· ${i.path}`
    )
    await log.add(retry ? 'release-retry' : 'release', `${retry ? 'Fortsatte utgivelsen' : 'Ga ut'} ${release.items.length} ${release.items.length === 1 ? 'endring' : 'endringer'}: ${formatStatus(release.status)}.${release.note ? ` Notat: ${release.note}` : ''}`, details)
    const c = release.check
    if (c && !c.skipped) {
      const problems = [...c.pages.flatMap((p) => p.problems.map((x) => `${p.path}: ${x}`)), ...c.assets.filter((a) => !a.ok).map((a) => `${a.url}: ${a.problem}`)]
      await log.add('check', c.ok ? `Sjekk etter opplasting: siden svarer som den skal (${c.pages.length} sider, ${c.assets.length} filer).` : 'Sjekk etter opplasting: noe så feil ut.', problems)
      if (c.autoUndone) await log.add('auto-undo', 'Utgivelsen ble angret automatisk fordi sjekken feilet.')
    }
  }

  /** Set the note on a release. `by` is the AI client's name when an AI wrote it (shown as "Skrevet av AI"). */
  async setNote(siteId: string, releaseId: string, note: string, by?: string): Promise<Release> {
    const { releases } = this.stores(siteId)
    const r = await releases.get(releaseId)
    if (!r) throw new UserError('Fant ikke utgivelsen.')
    const updated = { ...r, note: note.trim().slice(0, 2000) || undefined, noteBy: by }
    await releases.save(updated)
    return updated
  }

  private stores(siteId: string) {
    const dir = this.sites.store.siteDir(siteId)
    return { releases: new ReleaseStore(dir), snapshots: new SnapshotStore(dir), journal: new Journal(dir), diffs: new DiffStore(dir) }
  }

  private async exclusive<T>(siteId: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(siteId)) throw new UserError('Skyv holder allerede på med denne nettsiden.', 'Vent til det er ferdig.')
    this.busy.add(siteId)
    try {
      return await fn()
    } finally {
      this.busy.delete(siteId)
      // Show the new state of the change list afterwards.
      await this.workspaces.scan(siteId).catch(() => undefined)
    }
  }

  private async deps(siteId: string) {
    const site = await this.sites.require(siteId)
    const workspace = await this.workspaces.get(siteId)
    return {
      site,
      workspace,
      ...this.stores(siteId),
      connect: () => this.workspaces.connect(site),
      onProgress: this.onProgress
    }
  }

  isBusy(siteId: string): boolean {
    return this.busy.has(siteId)
  }

  list(siteId: string): Promise<Release[]> {
    return this.stores(siteId).releases.list()
  }

  /** Files in a release with stored line differences (or why there are none). */
  async changesIn(siteId: string, releaseId: string): Promise<FileChangeView[]> {
    const { releases, diffs } = this.stores(siteId)
    const r = await releases.get(releaseId)
    if (!r) throw new UserError('Fant ikke utgivelsen.')
    return releaseChanges(r, diffs)
  }

  /** Releases that touched one file, newest first, with notes and differences. */
  async fileHistory(siteId: string, path: string, limit = 50): Promise<FileHistoryEntry[]> {
    const { releases, diffs } = this.stores(siteId)
    return fileHistory(await releases.list(), diffs, path, limit)
  }

  /** What changed after release `from`, up to and including release `to`. */
  async compare(siteId: string, from: string, to: string): Promise<ReleaseComparison> {
    const { releases, diffs } = this.stores(siteId)
    return compareReleases(await releases.list(), diffs, from, to)
  }

  /** Give out the changes the user selected (by key). Only changes from the latest scan are accepted. */
  publish(siteId: string, keys: string[], note?: string, acknowledgeBlocking = false): Promise<Release> {
    return this.exclusive(siteId, async () => {
      // Rescan so we never upload based on stale information.
      const cs = await this.workspaces.scan(siteId)
      if (cs.needsStartingPoint || cs.needsCompare) throw new UserError('Velg utgangspunkt for nettsiden først.')
      const wanted = new Set(keys)
      const changes = cs.changes.filter((c) => wanted.has(changeKey(c)))
      if (changes.length === 0) throw new UserError('De valgte endringene finnes ikke lenger.', 'Listen er oppdatert. Se over og prøv igjen.')
      // The checks run here too, so nothing can bypass them (for example the menu bar).
      const { findings } = await this.checks.run(siteId, changes.map(changeKey))
      const blocking = findings.filter((f) => f.severity === 'block')
      if (blocking.length > 0 && !acknowledgeBlocking) {
        throw new UserError(
          `Utgivelsen ble stoppet fordi Skyv fant ${blocking.length === 1 ? 'et alvorlig problem' : `${blocking.length} alvorlige problemer`}.`,
          'Se funnene over knappen. Kryss av for "Jeg vet hva jeg gjør" hvis du er sikker.'
        )
      }
      const deps = await this.deps(siteId)
      const release = await new Publisher(deps).publish(changes, note?.trim() || undefined)
      const verified = await this.verify(deps, release, true)
      await this.logRelease(siteId, verified).catch(() => undefined)
      return verified
    })
  }

  /**
   * "Gi ut" from the menu bar: gives out the default selection (never deletions) after the
   * same checks as in the window. Anything that needs a decision sends the user to the window.
   */
  async quickRelease(siteId: string, acceptWarnings: boolean): Promise<QuickReleaseResult> {
    if (this.busy.has(siteId)) return { status: 'needs-review', reason: 'busy', message: 'Skyv holder allerede på med denne nettsiden.' }
    const cs = await this.workspaces.scan(siteId)
    if (cs.needsStartingPoint || cs.needsCompare) {
      return { status: 'needs-review', reason: 'starting-point', message: 'Velg utgangspunkt for nettsiden i hovedvinduet først.' }
    }
    const changes = cs.changes.filter((c) => c.kind !== 'deleted')
    if (changes.length === 0) return { status: 'nothing' }
    const keys = changes.map(changeKey)
    const { findings } = await this.checks.run(siteId, keys)
    if (findings.some((f) => f.severity === 'block')) {
      return { status: 'needs-review', reason: 'blocking', message: 'Skyv fant noe alvorlig i filene. Se gjennom i hovedvinduet.' }
    }
    const warnings = findings.filter((f) => f.severity === 'warn')
    if (warnings.length > 0 && !acceptWarnings) {
      return { status: 'warnings', count: warnings.length, examples: warnings.slice(0, 3).map((w) => (w.path ? `${w.path}: ${w.message}` : w.message)) }
    }
    // Deviations on the server for files that are going out need a decision in the main window.
    const deviating = new Set(await this.deviationPaths(siteId))
    if (changes.some((c) => deviating.has(c.path) || (c.from && deviating.has(c.from)))) {
      return { status: 'needs-review', reason: 'deviations', message: 'Noen av filene har avvik på serveren. Se gjennom i hovedvinduet.' }
    }
    const conflicts = await this.check(siteId, keys)
    if (conflicts.length > 0) {
      return { status: 'needs-review', reason: 'conflicts', message: 'Noen filer er endret på serveren siden sist. Velg hva som skal skje i hovedvinduet.' }
    }
    return { status: 'released', release: await this.publish(siteId, keys) }
  }

  /** Check the live site after a release (and undo automatically if the site wants that). */
  private async verify(deps: Awaited<ReturnType<ReleaseService['deps']>>, release: Release, allowAutoUndo: boolean): Promise<Release> {
    if (!release.items.some((i) => i.state === 'done')) return release
    this.onProgress({ siteId: release.siteId, releaseId: release.id, phase: 'verify', items: [], doneCount: 0, totalCount: 0, doneBytes: 0, totalBytes: 0 })
    try {
      const verified = await verifyRelease(deps, release, createFetcher(), { allowAutoUndo })
      if (verified.check) {
        await new HealthCheckStore(this.sites.store.siteDir(release.siteId))
          .save({ at: verified.check.checkedAt, source: 'release', releaseId: release.id, result: verified.check })
          .catch(() => undefined)
      }
      return verified
    } catch {
      return release
    }
  }

  /** "Sjekk igjen": run the check after upload again. Never undoes automatically. */
  recheck(siteId: string, releaseId: string): Promise<Release> {
    return this.exclusive(siteId, async () => {
      const deps = await this.deps(siteId)
      const release = await deps.releases.get(releaseId)
      if (!release) throw new UserError('Fant ikke utgivelsen.')
      await this.workspaces.scan(siteId)
      return this.verify(deps, release, false)
    })
  }

  /** Compare the server with what Skyv expects, for the selected changes. Nothing is changed. */
  async check(siteId: string, keys: string[]): Promise<Conflict[]> {
    const site = await this.sites.require(siteId)
    const ws = await this.workspaces.get(siteId)
    const cs = ws.lastChangeSet ?? (await this.workspaces.scan(siteId))
    const manifest = await ws.manifest.load()
    if (!manifest) return []
    const wanted = new Set(keys)
    const changes = cs.changes.filter((c) => wanted.has(changeKey(c)))
    const client = await this.workspaces.connect(site)
    try {
      return await findConflicts(changes, manifest, client, site.remoteRoot)
    } finally {
      await client.close()
    }
  }

  async conflictDiff(siteId: string, path: string): Promise<DiffResult> {
    const site = await this.sites.require(siteId)
    const ws = await this.workspaces.get(siteId)
    ws.localPath(path) // validates the path
    const client = await this.workspaces.connect(site)
    try {
      const server = await this.workspaces.fetchRemoteFile(client, joinRemote(site.remoteRoot, path))
      return await ws.diffWithServer(path, server)
    } finally {
      await client.close()
    }
  }

  retry(siteId: string, releaseId: string): Promise<Release> {
    return this.exclusive(siteId, async () => {
      const deps = await this.deps(siteId)
      const verified = await this.verify(deps, await new Publisher(deps).resume(releaseId), true)
      await this.logRelease(siteId, verified, true).catch(() => undefined)
      return verified
    })
  }

  async planUndo(siteId: string, releaseId: string, paths?: string[]): Promise<UndoStep[]> {
    const r = await this.stores(siteId).releases.get(releaseId)
    if (!r) throw new UserError('Fant ikke utgivelsen.')
    return planUndo(r, paths)
  }

  undo(siteId: string, releaseId: string, paths?: string[]): Promise<Release> {
    return this.exclusive(siteId, async () => {
      const log = this.logs.for(siteId)
      try {
        const r = await undoRelease(await this.deps(siteId), releaseId, paths)
        await log.add('undo', paths ? `Angret ${paths.length} ${paths.length === 1 ? 'fil' : 'filer'} fra utgivelsen ${r.startedAt}.` : `Angret utgivelsen ${r.startedAt}.`, paths)
        return r
      } catch (err) {
        await log.add('undo', `Angring feilet: ${err instanceof UserError ? err.message : 'ukjent feil'}`).catch(() => undefined)
        throw err
      }
    })
  }

  /** Releases or undo operations that were cut off (app crash, power loss). */
  async interrupted(): Promise<InterruptedRelease[]> {
    const out: InterruptedRelease[] = []
    for (const site of await this.sites.store.list()) {
      if (this.busy.has(site.id)) continue
      const { journal, releases } = this.stores(site.id)
      const j = await journal.get()
      if (!j) continue
      const r = await releases.get(j.releaseId)
      if (!r) {
        await journal.clear()
        continue
      }
      out.push({ siteId: site.id, siteName: site.name, releaseId: r.id, kind: j.kind, startedAt: r.startedAt })
    }
    return out
  }

  /** Dismiss an interrupted marker without doing anything. */
  async dismissInterrupted(siteId: string): Promise<void> {
    await this.stores(siteId).journal.clear()
  }
}

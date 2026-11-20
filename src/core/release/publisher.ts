import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import type { Site } from '../types'
import type { Change } from '../manifest/changes'
import type { ManifestEntry } from '../manifest/manifest'
import type { SiteWorkspace } from '../workspace'
import type { RemoteClient, RemoteEntry } from '../remote/types'
import { joinRemote, parentOf } from '../remote/paths'
import { hashFile } from '../scan/scanner'
import { UserError } from '../errors'
import { ReleaseStore, SnapshotStore, Journal, pruneSnapshots } from './stores'
import type { Release, ReleaseItem, ReleaseProgress } from './types'
import { DiffStore, diffForItem, pruneDiffs, MAX_DIFF_FILE_BYTES, DEFAULT_DIFF_MAX_MB, type StoredFileDiff } from './diffStore'
import { createHash } from 'node:crypto'
import { isTextPath } from '../files/fileTypes'

export interface RetryOptions {
  attempts: number
  baseDelayMs: number
}

export interface PublisherDeps {
  site: Site
  workspace: SiteWorkspace
  releases: ReleaseStore
  snapshots: SnapshotStore
  journal: Journal
  /** Where compact line differences are stored. Optional, so older callers keep working. */
  diffs?: DiffStore
  /** Opens and connects a new client. Called once per parallel connection, and again after a failure. */
  connect: () => Promise<RemoteClient>
  onProgress?: (p: ReleaseProgress) => void
  retry?: RetryOptions
  /** How often state is written to disk during a release (ms). */
  flushMs?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Temp name in the same folder, so the final rename is a cheap, atomic move on the server. */
export function tempNameFor(remotePath: string): string {
  const dir = parentOf(remotePath)
  const name = remotePath.slice(remotePath.lastIndexOf('/') + 1)
  return `${dir === '/' ? '' : dir}/.${name}.${randomBytes(4).toString('hex')}.skyvtmp`
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True if `name` is a temp file Skyv itself created for `target` (pattern from tempNameFor). */
export function isOwnTempFor(name: string, targetName: string): boolean {
  return new RegExp(`^\\.${escapeRegExp(targetName)}\\.[0-9a-f]{8}\\.skyvtmp$`).test(name)
}

export function itemsFromChanges(changes: Change[]): ReleaseItem[] {
  return changes.map((c) => ({
    path: c.path,
    kind: c.kind,
    action: c.kind === 'deleted' ? 'delete' : c.kind === 'renamed' ? 'rename' : 'upload',
    from: c.from,
    state: 'pending',
    size: c.kind === 'deleted' ? undefined : c.size,
    hash: c.hash
  }))
}

/** Lazily connected client that reconnects after a failure. */
class Conn {
  private client: RemoteClient | null = null
  constructor(private readonly open: () => Promise<RemoteClient>) {}
  async get(): Promise<RemoteClient> {
    this.client ??= await this.open()
    return this.client
  }
  async reset(): Promise<void> {
    const c = this.client
    this.client = null
    await c?.close().catch(() => undefined)
  }
}

/**
 * Gives out a set of changes:
 * 1. Takes a snapshot of every server file that will be overwritten or deleted.
 * 2. Uploads with N parallel connections, each file under a temporary name, then renamed into place.
 * 3. Updates the manifest only after a file is confirmed on the server.
 * Failed files do not stop the rest. Everything is recorded so it can be resumed or undone.
 */
export class Publisher {
  private release!: Release
  private manifestOps: Array<(files: Record<string, ManifestEntry>) => void> = []
  private dirty = false
  private pendingDiffs: StoredFileDiff[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private madeDirs = new Map<string, Promise<void>>()
  private pendingEvents: ReleaseProgress['items'] = []
  private lastEvent = 0

  constructor(private readonly deps: PublisherDeps) {}

  private get retry(): RetryOptions {
    return this.deps.retry ?? { attempts: 4, baseDelayMs: 1000 }
  }

  /** Start a new release for the given changes. */
  async publish(changes: Change[], note?: string): Promise<Release> {
    if (changes.length === 0) throw new UserError('Ingen endringer er valgt.')
    this.release = {
      id: `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
      siteId: this.deps.site.id,
      startedAt: new Date().toISOString(),
      status: 'in-progress',
      items: itemsFromChanges(changes),
      note,
      snapshot: 'kept',
      snapshotBytes: 0,
      diffs: this.deps.diffs ? 'kept' : undefined
    }
    await this.deps.releases.save(this.release)
    await this.deps.journal.set(this.release.id, 'release')
    return this.run()
  }

  /** Continue a release that was interrupted, or retry the files that failed. */
  async resume(releaseId: string): Promise<Release> {
    const r = await this.deps.releases.get(releaseId)
    if (!r) throw new UserError('Fant ikke utgivelsen.')
    if (r.status === 'undone' || r.status === 'partly-undone') throw new UserError('Utgivelsen er angret og kan ikke fortsettes.')
    if (r.snapshot !== 'kept') throw new UserError('Sikkerhetskopien for denne utgivelsen finnes ikke lenger, så den kan ikke fortsettes.')
    this.release = { ...r, status: 'in-progress', finishedAt: undefined, items: r.items.map((i) => (i.state === 'failed' ? { ...i, state: 'pending', error: undefined, hint: undefined } : i)) }
    await this.deps.releases.save(this.release)
    await this.deps.journal.set(this.release.id, 'release')
    return this.run()
  }

  private async run(): Promise<Release> {
    this.flushTimer = setInterval(() => void this.flush(), this.deps.flushMs ?? 500)
    try {
      await this.snapshotPhase()
      await this.flush(true)
      await this.uploadPhase()
    } finally {
      if (this.flushTimer) clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    const items = this.release.items
    const done = items.filter((i) => i.state === 'done').length
    const failed = items.filter((i) => i.state === 'failed').length
    this.release.status = failed === 0 ? 'success' : done > 0 ? 'partial' : 'failed'
    this.release.finishedAt = new Date().toISOString()
    this.release.snapshotBytes = await this.deps.snapshots.bytes(this.release.id)
    await this.flush(true)
    await this.deps.journal.clear()
    const s = this.deps.site.settings
    await pruneSnapshots(this.deps.releases, this.deps.snapshots, s.snapshotKeep, s.snapshotMaxMB * 1024 * 1024)
    if (this.deps.diffs) await pruneDiffs(this.deps.releases, this.deps.diffs, (s.diffMaxMB ?? DEFAULT_DIFF_MAX_MB) * 1024 * 1024).catch(() => [])
    this.emit('done', [])
    return (await this.deps.releases.get(this.release.id)) ?? this.release
  }

  // ---- state & progress -------------------------------------------------------------------

  private async flush(force = false): Promise<void> {
    if (!force && !this.dirty) return
    this.dirty = false
    const ops = this.manifestOps.splice(0)
    if (ops.length > 0) await this.deps.workspace.manifest.update((m) => ops.forEach((op) => op(m.files)))
    const diffs = this.pendingDiffs.splice(0)
    if (diffs.length > 0 && this.deps.diffs) await this.deps.diffs.put(this.release.id, this.release.startedAt, diffs).catch(() => undefined)
    await this.deps.releases.save(this.release)
  }

  private changed(op?: (files: Record<string, ManifestEntry>) => void): void {
    if (op) this.manifestOps.push(op)
    this.dirty = true
  }

  private emit(phase: ReleaseProgress['phase'], items: ReleaseProgress['items'], force = false): void {
    if (!this.deps.onProgress) return
    this.pendingEvents.push(...items)
    const now = Date.now()
    if (!force && phase !== 'done' && now - this.lastEvent < 80) return
    this.lastEvent = now
    const all = this.release.items
    const totalBytes = all.reduce((n, i) => n + (i.action !== 'delete' ? (i.size ?? 0) : 0), 0)
    const doneBytes = all.reduce((n, i) => n + (i.state === 'done' && i.action !== 'delete' ? (i.size ?? 0) : 0), 0)
    this.deps.onProgress({
      siteId: this.release.siteId,
      releaseId: this.release.id,
      phase,
      items: this.pendingEvents.splice(0),
      doneCount: all.filter((i) => i.state === 'done' || i.state === 'failed' || i.state === 'skipped').length,
      totalCount: all.length,
      doneBytes,
      totalBytes
    })
  }

  private fail(item: ReleaseItem, err: unknown): void {
    item.state = 'failed'
    const ue = err instanceof UserError ? err : new UserError('Filen kunne ikke lastes opp.', 'Prøv igjen om litt.')
    item.error = ue.message
    item.hint = ue.hint
    this.changed()
    this.emit('upload', [{ path: item.path, state: 'failed', error: item.error }], true)
  }

  private remote(rel: string): string {
    return joinRemote(this.deps.site.remoteRoot, rel)
  }

  // ---- phase 1: snapshot ------------------------------------------------------------------

  private async snapshotPhase(): Promise<void> {
    const pending = this.release.items.filter((i) => i.state === 'pending')
    if (pending.length === 0) return
    const conn = new Conn(this.deps.connect)
    const listings = new Map<string, Map<string, RemoteEntry>>()
    const existing = async (rel: string): Promise<RemoteEntry | null> => {
      const remotePath = this.remote(rel)
      const dir = parentOf(remotePath)
      if (!listings.has(dir)) {
        const entries = await this.withRetry(conn, (c) => c.list(dir)).catch(() => [] as RemoteEntry[])
        listings.set(dir, new Map(entries.map((e) => [e.name, e])))
      }
      const e = listings.get(dir)!.get(remotePath.slice(remotePath.lastIndexOf('/') + 1))
      return e && e.type === 'file' ? e : null
    }
    const index = await this.deps.snapshots.index(this.release.id)

    const take = async (rel: string): Promise<boolean> => {
      if (index.files[rel]) return true
      const remoteFile = await existing(rel)
      if (!remoteFile) return false
      const dest = this.deps.snapshots.filePath(this.release.id, rel)
      await fs.mkdir(dirname(dest), { recursive: true })
      await this.withRetry(conn, (c) => c.download(this.remote(rel), dest))
      const st = await fs.stat(dest)
      const info = { hash: await hashFile(dest), size: st.size }
      await this.deps.snapshots.record(this.release.id, rel, info)
      index.files[rel] = info
      return true
    }

    try {
      // Remove half-finished temp files left by an earlier, interrupted attempt (only Skyv's own names).
      for (const item of pending) {
        if (item.action === 'delete') continue
        const target = this.remote(item.path)
        const dir = parentOf(target)
        await existing(item.path).catch(() => null)
        const targetName = target.slice(target.lastIndexOf('/') + 1)
        for (const name of [...(listings.get(dir)?.keys() ?? [])]) {
          if (!isOwnTempFor(name, targetName)) continue
          await this.withRetry(conn, (c) => c.remove(joinRemote(dir, name))).catch(() => undefined)
          listings.get(dir)!.delete(name)
        }
      }
      for (const item of pending) {
        try {
          this.emit('snapshot', [{ path: item.path, state: 'pending' }])
          item.existedBefore ??= await take(item.path)
          if (item.action === 'rename' && item.from) item.fromExistedBefore ??= await take(item.from)
          this.changed()
        } catch (err) {
          // Without a backup we must not touch this file on the server.
          this.fail(item, err instanceof UserError ? new UserError(`Kunne ikke ta sikkerhetskopi: ${err.message}`, err.hint) : err)
        }
      }
    } finally {
      await conn.reset()
    }
  }

  // ---- phase 2: upload ----------------------------------------------------------------------

  private async uploadPhase(): Promise<void> {
    const queue = this.release.items.filter((i) => i.state === 'pending')
    if (queue.length === 0) return
    const workers = Math.max(1, Math.min(this.deps.site.settings.concurrency, queue.length))
    let next = 0
    const work = async () => {
      const conn = new Conn(this.deps.connect)
      try {
        while (next < queue.length) {
          const item = queue[next++]
          try {
            await this.processItem(conn, item)
          } catch (err) {
            this.fail(item, err)
          }
        }
      } finally {
        await conn.reset()
      }
    }
    await Promise.all(Array.from({ length: workers }, work))
  }

  private async withRetry<T>(conn: Conn, fn: (c: RemoteClient) => Promise<T>): Promise<T> {
    let lastErr: unknown
    for (let attempt = 0; attempt < this.retry.attempts; attempt++) {
      try {
        return await fn(await conn.get())
      } catch (err) {
        lastErr = err
        await conn.reset()
        if (attempt < this.retry.attempts - 1) await sleep(this.retry.baseDelayMs * 2 ** attempt)
      }
    }
    throw lastErr
  }

  private ensureDir(conn: Conn, remoteDir: string): Promise<void> {
    if (remoteDir === '/' || remoteDir === this.deps.site.remoteRoot) return Promise.resolve()
    let p = this.madeDirs.get(remoteDir)
    if (!p) {
      p = this.withRetry(conn, (c) => c.ensureDir(remoteDir))
      p.catch(() => this.madeDirs.delete(remoteDir))
      this.madeDirs.set(remoteDir, p)
    }
    return p
  }

  /** Upload one local file to `rel` via a temp name. Returns the manifest entry for it. */
  private async uploadFile(conn: Conn, item: ReleaseItem, rel: string): Promise<ManifestEntry | null> {
    const local = this.deps.workspace.localPath(rel)
    const before = await fs.stat(local).catch(() => null)
    if (!before?.isFile()) throw new UserError('Filen finnes ikke lenger på Macen.', 'Se etter endringer på nytt.')
    const hash = await hashFile(local)
    // Keep the given-out text for the stored difference (small text files only).
    if (this.deps.diffs && isTextPath(rel) && before.size <= MAX_DIFF_FILE_BYTES) {
      const buf = await fs.readFile(local).catch(() => null)
      if (buf && createHash('sha256').update(buf).digest('hex') === hash) this.newContent.set(item.path, buf)
    }
    const target = this.remote(rel)
    await this.ensureDir(conn, parentOf(target))

    const remoteInfo = await this.withRetry(conn, async (c) => {
      const tmp = tempNameFor(target)
      try {
        await c.upload(local, tmp, (bytes) => this.emit('upload', [{ path: item.path, state: 'uploading', bytes, size: before.size }]))
        await c.rename(tmp, target)
      } catch (err) {
        await c.remove(tmp).catch(() => undefined)
        throw err
      }
      return c.stat(target)
    })

    const after = await fs.stat(local).catch(() => null)
    item.hash = hash
    item.size = before.size
    await this.deps.workspace.copies.putFile(hash, rel, local, before.size).catch(() => undefined)
    // If the file changed while it was uploading, do not claim the new content is live.
    if (!after || after.size !== before.size || Math.round(after.mtimeMs) !== Math.round(before.mtimeMs)) return null
    return {
      hash,
      size: before.size,
      localMtimeMs: Math.round(before.mtimeMs),
      remoteSize: remoteInfo?.size,
      remoteMtimeMs: remoteInfo?.modifiedAt,
      publishedAt: new Date().toISOString(),
      releaseId: this.release.id
    }
  }

  private async processItem(conn: Conn, item: ReleaseItem): Promise<void> {
    if (item.action === 'upload') {
      const entry = await this.uploadFile(conn, item, item.path)
      await this.markDone(item, (files) => {
        if (entry) files[item.path] = entry
      })
      return
    }
    if (item.action === 'delete') {
      if (item.existedBefore) await this.withRetry(conn, (c) => c.remove(this.remote(item.path)))
      await this.markDone(item, (files) => {
        delete files[item.path]
      })
      return
    }
    // rename: move on the server when possible (no upload needed), otherwise upload the new path.
    const from = item.from!
    let entry: ManifestEntry | null = null
    if (item.fromExistedBefore) {
      const target = this.remote(item.path)
      await this.ensureDir(conn, parentOf(target))
      const info = await this.withRetry(conn, async (c) => {
        await c.rename(this.remote(from), target)
        return c.stat(target)
      })
      const local = this.deps.workspace.localPath(item.path)
      const st = await fs.stat(local).catch(() => null)
      if (st && item.hash) {
        entry = {
          hash: item.hash,
          size: st.size,
          localMtimeMs: Math.round(st.mtimeMs),
          remoteSize: info?.size,
          remoteMtimeMs: info?.modifiedAt,
          publishedAt: new Date().toISOString(),
          releaseId: this.release.id
        }
      }
    } else {
      entry = await this.uploadFile(conn, item, item.path)
    }
    await this.markDone(item, (files) => {
      delete files[from]
      if (entry) files[item.path] = entry
    })
  }

  private newContent = new Map<string, Buffer>()

  /** Work out the stored difference for a finished item. Never fails the release. */
  private async recordDiff(item: ReleaseItem): Promise<void> {
    if (!this.deps.diffs) return
    try {
      const newContent = this.newContent.get(item.path) ?? null
      this.newContent.delete(item.path)
      let oldContent: Buffer | null = null
      let oldTooLarge = false
      if (item.action !== 'delete' && item.existedBefore && isTextPath(item.path)) {
        const p = this.deps.snapshots.filePath(this.release.id, item.path)
        const st = await fs.stat(p).catch(() => null)
        if (st && st.size > MAX_DIFF_FILE_BYTES) oldTooLarge = true
        else if (st) oldContent = await fs.readFile(p)
      }
      let d = diffForItem(item, oldContent, newContent)
      // Text we could not capture (too large, or changed while reading) gets no line difference.
      if (d.kind === 'text' && (oldTooLarge || !newContent)) d = { path: d.path, from: d.from, kind: 'too-large', added: 0, removed: 0 }
      this.pendingDiffs.push(d)
    } catch {
      // A missing difference only makes history less detailed.
    }
  }

  private async markDone(item: ReleaseItem, op: (files: Record<string, ManifestEntry>) => void): Promise<void> {
    await this.recordDiff(item)
    item.state = 'done'
    this.changed(op)
    this.emit('upload', [{ path: item.path, state: 'done' }], true)
  }
}

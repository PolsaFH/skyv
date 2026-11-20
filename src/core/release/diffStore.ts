import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJsonAtomic, Mutex } from '../storage/atomicJson'
import { textDiff, type DiffRow, type TextDiff } from '../diff/textDiff'
import { isTextPath } from '../files/fileTypes'
import type { Release, ReleaseItem } from './types'

/** Text files larger than this get no stored difference. */
export const MAX_DIFF_FILE_BYTES = 200 * 1024
/** Default limit for all stored differences of one site. */
export const DEFAULT_DIFF_MAX_MB = 50

export type StoredDiffKind = 'text' | 'binary' | 'too-large' | 'deleted' | 'renamed'

export interface StoredFileDiff {
  path: string
  kind: StoredDiffKind
  from?: string
  added: number
  removed: number
  /**
   * Compact line format, one entry per row: "+text", "-text", " text", or "@N" for N unchanged
   * lines left out. Line numbers are rebuilt from the order.
   */
  lines?: string[]
}

export interface StoredReleaseDiffs {
  releaseId: string
  at: string
  files: Record<string, StoredFileDiff>
}

/** Turn a diff into the compact stored form. */
export function packRows(rows: DiffRow[]): string[] {
  return rows.map((r) => (r.kind === 'gap' ? `@${r.hidden ?? 0}` : `${r.kind === 'added' ? '+' : r.kind === 'removed' ? '-' : ' '}${r.text}`))
}

/** Rebuild diff rows (with line numbers) from the compact stored form. */
export function unpackRows(lines: string[]): DiffRow[] {
  const rows: DiffRow[] = []
  let o = 1
  let n = 1
  for (const l of lines) {
    const sign = l[0]
    const text = l.slice(1)
    if (sign === '@') {
      const hidden = Number(text) || 0
      rows.push({ kind: 'gap', text: '', hidden })
      o += hidden
      n += hidden
    } else if (sign === '+') rows.push({ kind: 'added', newNo: n++, text })
    else if (sign === '-') rows.push({ kind: 'removed', oldNo: o++, text })
    else rows.push({ kind: 'same', oldNo: o++, newNo: n++, text })
  }
  return rows
}

export function toTextDiff(d: StoredFileDiff): TextDiff | null {
  if (d.kind !== 'text' || !d.lines) return null
  return { rows: unpackRows(d.lines), added: d.added, removed: d.removed, identical: d.added === 0 && d.removed === 0 }
}

function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0)
}

/**
 * Work out the stored difference for one finished item.
 * `oldContent` is the server's version before the release (null if the file was new),
 * `newContent` the local file that was given out.
 */
export function diffForItem(item: ReleaseItem, oldContent: Buffer | null, newContent: Buffer | null): StoredFileDiff {
  if (item.action === 'delete') return { path: item.path, kind: 'deleted', added: 0, removed: 0 }
  if (item.action === 'rename' && item.fromExistedBefore) return { path: item.path, kind: 'renamed', from: item.from, added: 0, removed: 0 }
  const base = { path: item.path, from: item.from }
  if (!isTextPath(item.path) || (newContent && looksBinary(newContent)) || (oldContent && looksBinary(oldContent))) return { ...base, kind: 'binary', added: 0, removed: 0 }
  if ((newContent?.length ?? 0) > MAX_DIFF_FILE_BYTES || (oldContent?.length ?? 0) > MAX_DIFF_FILE_BYTES) return { ...base, kind: 'too-large', added: 0, removed: 0 }
  const d = textDiff(oldContent?.toString('utf8') ?? '', newContent?.toString('utf8') ?? '')
  return { ...base, kind: 'text', added: d.added, removed: d.removed, lines: packRows(d.rows) }
}

/**
 * Compact differences per release, kept apart from the backups so they live longer.
 * Layout: diffs/<releaseId>.json
 */
export class DiffStore {
  private mutex = new Mutex()

  constructor(private readonly siteDir: string) {}

  private get dir(): string {
    return join(this.siteDir, 'diffs')
  }

  private file(releaseId: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(releaseId)) throw new Error('Invalid release id')
    return join(this.dir, `${releaseId}.json`)
  }

  async get(releaseId: string): Promise<StoredReleaseDiffs | null> {
    return readJson<StoredReleaseDiffs | null>(this.file(releaseId), null)
  }

  /** Add or replace file differences for a release (merges with what is stored, for resumed releases). */
  async put(releaseId: string, at: string, files: StoredFileDiff[]): Promise<void> {
    if (files.length === 0) return
    await this.mutex.run(async () => {
      const cur = (await this.get(releaseId)) ?? { releaseId, at, files: {} }
      for (const f of files) cur.files[f.path] = f
      await writeJsonAtomic(this.file(releaseId), cur)
    })
  }

  /** Size on disk per release id. */
  async sizes(): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    const names = await fs.readdir(this.dir).catch(() => [] as string[])
    for (const n of names) {
      if (!n.endsWith('.json')) continue
      const st = await fs.stat(join(this.dir, n)).catch(() => null)
      if (st) out.set(n.slice(0, -5), st.size)
    }
    return out
  }

  async remove(releaseId: string): Promise<void> {
    await fs.rm(this.file(releaseId), { force: true })
  }
}

/**
 * Keep stored differences under `maxBytes` for the site, removing the oldest first.
 * Marks those releases with `diffs: 'pruned'`. Returns the removed ids.
 */
export async function pruneDiffs(releases: { list(): Promise<Release[]>; save(r: Release): Promise<void> }, diffs: DiffStore, maxBytes: number): Promise<string[]> {
  const sizes = await diffs.sizes()
  const list = await releases.list() // newest first
  let total = 0
  let full = false
  const removed: string[] = []
  for (const r of list) {
    const size = sizes.get(r.id)
    if (size === undefined) continue
    sizes.delete(r.id)
    if (r.status === 'in-progress' || (!full && total + size <= maxBytes)) {
      total += size
      continue
    }
    // Once the limit is reached, everything older goes, so history is never full of holes.
    full = true
    await diffs.remove(r.id)
    await releases.save({ ...r, diffs: 'pruned' })
    removed.push(r.id)
  }
  // Files with no matching release record are leftovers.
  for (const id of sizes.keys()) await diffs.remove(id)
  return removed
}

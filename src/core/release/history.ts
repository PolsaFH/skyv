import { UserError } from '../errors'
import type { TextDiff } from '../diff/textDiff'
import { toTextDiff, type DiffStore, type StoredFileDiff, type StoredReleaseDiffs } from './diffStore'
import type { Release, ReleaseItem } from './types'

/** One file in one release, with its stored difference or a Norwegian explanation of why there is none. */
export interface FileChangeView {
  path: string
  action: ReleaseItem['action']
  from?: string
  state: ReleaseItem['state']
  undone: boolean
  added: number
  removed: number
  diff: TextDiff | null
  /** Why no line difference is shown (Norwegian, for the user and the AI). */
  explanation?: string
}

export interface FileHistoryEntry {
  releaseId: string
  at: string
  status: Release['status']
  note?: string
  noteBy?: string
  change: FileChangeView
}

export const NO_DIFFS_OLD = 'Utgivelsen er fra før Skyv lagret forskjeller, så bare fillisten og notatet finnes.'
export const NO_DIFFS_PRUNED = 'Forskjellene for denne utgivelsen er ryddet bort for å holde seg under grensen for lagrede forskjeller. Fillisten og notatet finnes fortsatt.'

function explain(release: Release, item: ReleaseItem, stored: StoredFileDiff | undefined, all: StoredReleaseDiffs | null): string | undefined {
  if (item.state !== 'done') return 'Filen ble ikke lagt ut i denne utgivelsen.'
  if (!stored) {
    if (release.diffs === 'pruned') return NO_DIFFS_PRUNED
    if (!release.diffs || !all) return NO_DIFFS_OLD
    return 'Skyv har ingen lagret forskjell for denne filen.'
  }
  switch (stored.kind) {
    case 'text':
      return undefined
    case 'binary':
      return 'Ikke en tekstfil (for eksempel et bilde), så bare navnet er lagret.'
    case 'too-large':
      return 'Filen er større enn 200 KB, så forskjellen ble ikke lagret.'
    case 'deleted':
      return 'Filen ble slettet fra serveren.'
    case 'renamed':
      return `Filen ble flyttet fra ${stored.from ?? item.from ?? 'et annet sted'} uten å endre innholdet.`
  }
}

function view(release: Release, item: ReleaseItem, all: StoredReleaseDiffs | null): FileChangeView {
  const stored = all?.files[item.path]
  return {
    path: item.path,
    action: item.action,
    from: item.from,
    state: item.state,
    undone: item.undone ?? false,
    added: stored?.added ?? 0,
    removed: stored?.removed ?? 0,
    diff: stored ? toTextDiff(stored) : null,
    explanation: explain(release, item, stored, all)
  }
}

/** All files in a release with their stored differences. */
export async function releaseChanges(release: Release, diffs: DiffStore): Promise<FileChangeView[]> {
  const all = await diffs.get(release.id).catch(() => null)
  return release.items.map((i) => view(release, i, all))
}

/** Releases that touched `path` (as target or as the old name of a move), newest first. */
export async function fileHistory(releases: Release[], diffs: DiffStore, path: string, limit = 50): Promise<FileHistoryEntry[]> {
  const out: FileHistoryEntry[] = []
  for (const r of releases) {
    const item = r.items.find((i) => i.path === path || i.from === path)
    if (!item) continue
    const all = await diffs.get(r.id).catch(() => null)
    out.push({ releaseId: r.id, at: r.startedAt, status: r.status, note: r.note, noteBy: r.noteBy, change: view(r, item, all) })
    if (out.length >= limit) break
  }
  return out
}

export interface ReleaseComparison {
  from: Release
  to: Release
  /** Releases after `from` up to and including `to`, oldest first. */
  between: Release[]
  /** Per file, the changes in order (oldest first). */
  files: Array<{ path: string; changes: Array<{ releaseId: string; at: string; change: FileChangeView }> }>
}

/**
 * What changed between two releases: everything given out after `fromId`, up to and including `toId`.
 * The order of the two ids does not matter.
 */
export async function compareReleases(releases: Release[], diffs: DiffStore, fromId: string, toId: string, maxReleases = 50): Promise<ReleaseComparison> {
  const chrono = [...releases].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  let a = chrono.findIndex((r) => r.id === fromId)
  let b = chrono.findIndex((r) => r.id === toId)
  if (a < 0) throw new UserError(`Fant ingen utgivelse med id "${fromId}".`)
  if (b < 0) throw new UserError(`Fant ingen utgivelse med id "${toId}".`)
  if (a > b) [a, b] = [b, a]
  const between = chrono.slice(a + 1, b + 1)
  if (between.length > maxReleases) throw new UserError(`Det er ${between.length} utgivelser mellom disse to. Velg to som ligger nærmere hverandre (høyst ${maxReleases}).`)
  const byPath = new Map<string, Array<{ releaseId: string; at: string; change: FileChangeView }>>()
  for (const r of between) {
    for (const c of await releaseChanges(r, diffs)) {
      if (c.state !== 'done') continue
      const list = byPath.get(c.path) ?? []
      list.push({ releaseId: r.id, at: r.startedAt, change: c })
      byPath.set(c.path, list)
    }
  }
  return {
    from: chrono[a],
    to: chrono[b],
    between,
    files: [...byPath.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([path, changes]) => ({ path, changes }))
  }
}

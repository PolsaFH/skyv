import type { ChangeKind } from '../manifest/changes'
import type { PostCheckResult } from '../verify/postCheck'

export type ReleaseStatus = 'in-progress' | 'success' | 'partial' | 'failed' | 'undone' | 'partly-undone'
export type ItemAction = 'upload' | 'delete' | 'rename'
export type ItemState = 'pending' | 'done' | 'failed' | 'skipped'

export interface ReleaseItem {
  /** Target path (relative to the site root). */
  path: string
  kind: ChangeKind
  action: ItemAction
  /** For renames: the old path. */
  from?: string
  state: ItemState
  /** Friendly Norwegian message if it failed. */
  error?: string
  hint?: string
  /** True if `path` existed on the server before this release (the snapshot holds the old version). */
  existedBefore?: boolean
  /** For renames: true if `from` existed on the server before. */
  fromExistedBefore?: boolean
  /** Size of the local file that was given out. */
  size?: number
  hash?: string
  /** Set when this item has been undone. */
  undone?: boolean
}

export interface Release {
  id: string
  siteId: string
  startedAt: string
  finishedAt?: string
  status: ReleaseStatus
  items: ReleaseItem[]
  /** Optional note/summary written by the user. */
  note?: string
  /** Set when the note was written by an AI client (its name), shown as "Skrevet av AI". */
  noteBy?: string
  /** "kept": undo possible; "pruned": snapshot removed by retention rules. */
  snapshot: 'kept' | 'pruned'
  snapshotBytes: number
  /** Stored line differences: "kept", "pruned" by the size limit, or missing (from before Skyv stored them). */
  diffs?: 'kept' | 'pruned'
  undoneAt?: string
  /** Result of the check of the live site after upload. */
  check?: PostCheckResult
}

export interface ReleaseProgress {
  siteId: string
  releaseId: string
  phase: 'snapshot' | 'upload' | 'undo' | 'verify' | 'done'
  /** Per-item updates since last event. */
  items: Array<{ path: string; state: ItemState | 'uploading'; bytes?: number; size?: number; error?: string }>
  doneCount: number
  totalCount: number
  doneBytes: number
  totalBytes: number
}

/** Sort helper: newest release first. */
export function newestFirst(a: Release, b: Release): number {
  return b.startedAt.localeCompare(a.startedAt)
}

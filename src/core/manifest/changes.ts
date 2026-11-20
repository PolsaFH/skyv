import type { ScannedFile } from '../scan/scanner'
import type { Manifest } from './manifest'
import type { IgnoreMatcher } from '../scan/ignoreRules'

export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed'

export interface Change {
  /** Current path (for deleted: the path that disappeared). */
  path: string
  kind: ChangeKind
  /** For renamed: the old path. */
  from?: string
  size: number
  hash?: string
  oldHash?: string
  mtimeMs?: number
}

function dirOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

function baseOf(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}

/**
 * Compare the local scan with the manifest.
 * - added: file not in manifest; modified: different hash; deleted: in manifest, gone locally.
 * - renamed: a deleted and an added file with identical content (incl. changes of upper/lower case).
 * - Files that are ignored now are never reported as deleted, so adding an ignore rule
 *   can never lead to deleting something on the server.
 */
export function detectChanges(files: Map<string, ScannedFile>, manifest: Manifest | null, ignore?: IgnoreMatcher): Change[] {
  const published = manifest?.files ?? {}
  const added: Change[] = []
  const modified: Change[] = []
  const deleted: Change[] = []

  for (const f of files.values()) {
    const prev = published[f.path]
    if (!prev) added.push({ path: f.path, kind: 'added', size: f.size, hash: f.hash, mtimeMs: f.mtimeMs })
    else if (prev.hash !== f.hash)
      modified.push({ path: f.path, kind: 'modified', size: f.size, hash: f.hash, oldHash: prev.hash, mtimeMs: f.mtimeMs })
  }
  for (const [path, entry] of Object.entries(published)) {
    if (files.has(path)) continue
    if (ignore?.(path)) continue
    deleted.push({ path, kind: 'deleted', size: entry.size, oldHash: entry.hash })
  }

  // Pair deleted + added with the same content as renames. Prefer same name, then same folder.
  const addedByHash = new Map<string, Change[]>()
  for (const a of added) {
    const list = addedByHash.get(a.hash!) ?? []
    list.push(a)
    addedByHash.set(a.hash!, list)
  }
  const renamed: Change[] = []
  const pairedAdded = new Set<Change>()
  const remainingDeleted: Change[] = []
  for (const d of deleted) {
    const options = (addedByHash.get(d.oldHash!) ?? []).filter((a) => !pairedAdded.has(a))
    if (options.length === 0) {
      remainingDeleted.push(d)
      continue
    }
    const pick =
      options.find((a) => baseOf(a.path).toLowerCase() === baseOf(d.path).toLowerCase()) ??
      options.find((a) => dirOf(a.path) === dirOf(d.path)) ??
      options[0]
    pairedAdded.add(pick)
    renamed.push({ path: pick.path, kind: 'renamed', from: d.path, size: pick.size, hash: pick.hash, oldHash: d.oldHash, mtimeMs: pick.mtimeMs })
  }

  const result = [...added.filter((a) => !pairedAdded.has(a)), ...modified, ...renamed, ...remainingDeleted]
  return result.sort((a, b) => a.path.localeCompare(b.path, 'nb'))
}

/** Deletions are never selected by default; everything else is. */
export function selectedByDefault(change: Change): boolean {
  return change.kind !== 'deleted'
}

/** Stable key for a change, used to refer to it across scans and between processes. */
export function changeKey(c: Pick<Change, 'kind' | 'from' | 'path'>): string {
  return `${c.kind}:${c.from ?? ''}:${c.path}`
}

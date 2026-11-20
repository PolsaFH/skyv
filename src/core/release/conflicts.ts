import type { Change } from '../manifest/changes'
import type { Manifest } from '../manifest/manifest'
import type { RemoteEntry, RemoteLister } from '../remote/types'
import { joinRemote, parentOf } from '../remote/paths'

export type ConflictReason = 'changed-on-server' | 'exists-on-server'

export interface Conflict {
  path: string
  reason: ConflictReason
  /** The change this conflict belongs to. */
  changeKind: Change['kind']
  remoteSize: number
  remoteModifiedAt?: number
  /** What Skyv expected based on the last release. */
  expectedSize?: number
  expectedModifiedAt?: number
}

/** Allow for servers that round modification times. */
const TIME_TOLERANCE_MS = 1000

/**
 * Before overwriting or deleting, check whether someone else changed the file on the server
 * since Skyv last gave it out (different size or modification time), or put a file where Skyv
 * is about to add a new one. Never changes anything on the server.
 */
export async function findConflicts(changes: Change[], manifest: Manifest, lister: RemoteLister, remoteRoot: string): Promise<Conflict[]> {
  const listings = new Map<string, Map<string, RemoteEntry> | null>()
  const remoteEntry = async (rel: string): Promise<RemoteEntry | null> => {
    const full = joinRemote(remoteRoot, rel)
    const dir = parentOf(full)
    if (!listings.has(dir)) {
      try {
        listings.set(dir, new Map((await lister.list(dir)).map((e) => [e.name, e])))
      } catch {
        listings.set(dir, null) // Folder does not exist (yet): nothing to conflict with.
      }
    }
    const e = listings.get(dir)?.get(full.slice(full.lastIndexOf('/') + 1))
    return e && e.type === 'file' ? e : null
  }

  // The very first release after "upload everything" is expected to replace what is there.
  const firstRelease = Object.keys(manifest.files).length === 0
  const out: Conflict[] = []

  const check = async (rel: string, kind: Change['kind']) => {
    const remote = await remoteEntry(rel)
    if (!remote) return
    const entry = manifest.files[rel]
    if (!entry) {
      if (!firstRelease) out.push({ path: rel, reason: 'exists-on-server', changeKind: kind, remoteSize: remote.size, remoteModifiedAt: remote.modifiedAt })
      return
    }
    const expectedSize = entry.remoteSize ?? entry.size
    const sizeDiffers = remote.size !== expectedSize
    const timeDiffers =
      entry.remoteMtimeMs !== undefined && remote.modifiedAt !== undefined && Math.abs(remote.modifiedAt - entry.remoteMtimeMs) > TIME_TOLERANCE_MS
    if (sizeDiffers || timeDiffers) {
      out.push({
        path: rel,
        reason: 'changed-on-server',
        changeKind: kind,
        remoteSize: remote.size,
        remoteModifiedAt: remote.modifiedAt,
        expectedSize,
        expectedModifiedAt: entry.remoteMtimeMs
      })
    }
  }

  for (const c of changes) {
    if (c.kind === 'renamed') {
      await check(c.path, c.kind)
      if (c.from) await check(c.from, c.kind)
    } else {
      await check(c.path, c.kind)
    }
  }
  return out
}

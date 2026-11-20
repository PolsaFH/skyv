import type { RemoteEntry, RemoteLister } from './types'
import { joinRemote } from './paths'
import type { IgnoreMatcher } from '../scan/ignoreRules'

export interface RemoteFile {
  path: string
  size: number
  modifiedAt?: number
}

export interface ListTreeOptions {
  ignore?: IgnoreMatcher
  onProgress?: (foldersListed: number, filesFound: number) => void
  /** Safety limit on number of folders listed. */
  maxFolders?: number
  signal?: AbortSignal
  /**
   * Called when a sub folder cannot be listed. When given, the listing continues and the
   * folder is reported here instead of failing the whole listing. The root must always be listable.
   */
  onFolderError?: (relFolder: string, err: unknown) => void
  /** Called if the folder limit was reached before everything was listed. */
  onTruncated?: () => void
}

/**
 * List every file under `root` on the server (relative paths, forward slashes).
 * Ignored folders are not entered. Symbolic links on the server are not followed.
 */
export async function listRemoteTree(lister: RemoteLister, root: string, opts: ListTreeOptions = {}): Promise<Map<string, RemoteFile>> {
  const files = new Map<string, RemoteFile>()
  const queue: string[] = ['']
  let folders = 0
  const max = opts.maxFolders ?? 5000
  while (queue.length > 0) {
    if (opts.signal?.aborted) throw new Error('aborted')
    const rel = queue.shift()!
    if (folders >= max) {
      opts.onTruncated?.()
      break
    }
    folders++
    let entries: RemoteEntry[]
    try {
      entries = await lister.list(joinRemote(root, rel))
    } catch (err) {
      if (!rel || !opts.onFolderError) throw err
      opts.onFolderError(rel, err)
      continue
    }
    for (const e of entries) {
      if (e.name === '.' || e.name === '..' || e.name.includes('/')) continue
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.type === 'dir') {
        if (opts.ignore?.(childRel, true)) continue
        queue.push(childRel)
      } else if (e.type === 'file') {
        if (opts.ignore?.(childRel)) continue
        files.set(childRel, { path: childRel, size: e.size, modifiedAt: e.modifiedAt })
      }
    }
    opts.onProgress?.(folders, files.size)
  }
  return files
}

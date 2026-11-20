import { join } from 'node:path'
import type { ScannedFile } from '../scan/scanner'
import type { RemoteFile } from '../remote/listTree'
import { emptyManifest, type Manifest, type ManifestEntry } from './manifest'

/**
 * Marker hash for a file that exists on the server with content Skyv has not seen.
 * It never equals a real hash, so the file shows up as "endret" (not "ny") and is never paired as a rename.
 */
export const UNKNOWN_REMOTE_HASH = 'server-version-unknown'

/** "Ja, start herfra": everything local counts as already given out. */
export function manifestFromLocal(files: Map<string, ScannedFile>, now = new Date().toISOString()): Manifest {
  const m = emptyManifest()
  for (const f of files.values()) {
    m.files[f.path] = { hash: f.hash, size: f.size, localMtimeMs: f.mtimeMs, publishedAt: now }
  }
  return m
}

export interface CompareResult {
  /** Files that are the same on the server; they go into the manifest. */
  same: string[]
  /** Same size, but content could not be confirmed (quick check only). */
  sameSizeUnverified: string[]
  /** Exists on both, but differs. */
  different: string[]
  /** Only on the Mac. */
  onlyLocal: string[]
  /** Only on the server (never deleted by Skyv unless the user chooses). */
  onlyRemote: string[]
  manifest: Manifest
}

const nfc = (s: string) => s.normalize('NFC')

/**
 * "Sammenlign med serveren".
 * Quick check: same size counts as same. Deep check: `remoteHash` downloads and hashes files
 * with the same size; only identical content counts as same.
 */
export async function compareWithRemote(
  local: Map<string, ScannedFile>,
  remote: Map<string, RemoteFile>,
  opts: { remoteHash?: (path: string) => Promise<string | null>; onProgress?: (done: number, total: number) => void } = {}
): Promise<CompareResult> {
  const remoteByKey = new Map<string, RemoteFile>()
  for (const r of remote.values()) remoteByKey.set(nfc(r.path), r)

  const result: CompareResult = { same: [], sameSizeUnverified: [], different: [], onlyLocal: [], onlyRemote: [], manifest: emptyManifest() }
  const now = new Date().toISOString()
  const seenRemote = new Set<string>()
  const candidates: Array<{ f: ScannedFile; r: RemoteFile }> = []

  for (const f of local.values()) {
    const r = remoteByKey.get(nfc(f.path))
    if (!r) {
      result.onlyLocal.push(f.path)
      continue
    }
    seenRemote.add(nfc(r.path))
    if (r.size !== f.size) {
      result.different.push(f.path)
      result.manifest.files[f.path] = differentEntry(r, UNKNOWN_REMOTE_HASH, now)
    } else candidates.push({ f, r })
  }
  for (const r of remote.values()) if (!seenRemote.has(nfc(r.path))) result.onlyRemote.push(r.path)

  let done = 0
  for (const { f, r } of candidates) {
    let same = true
    if (opts.remoteHash) {
      const h = await opts.remoteHash(r.path)
      same = h === f.hash
      if (same) result.same.push(f.path)
      else {
        result.different.push(f.path)
        result.manifest.files[f.path] = differentEntry(r, h ?? UNKNOWN_REMOTE_HASH, now)
      }
    } else {
      result.sameSizeUnverified.push(f.path)
    }
    if (same) {
      const entry: ManifestEntry = {
        hash: f.hash,
        size: f.size,
        localMtimeMs: f.mtimeMs,
        remoteSize: r.size,
        remoteMtimeMs: r.modifiedAt,
        publishedAt: now
      }
      result.manifest.files[f.path] = entry
    }
    opts.onProgress?.(++done, candidates.length)
  }
  for (const k of ['same', 'sameSizeUnverified', 'different', 'onlyLocal', 'onlyRemote'] as const) result[k].sort()
  return result
}

/** Manifest entry describing what is on the server for a file that differs from the Mac. */
function differentEntry(r: RemoteFile, hash: string, now: string): ManifestEntry {
  return { hash, size: r.size, localMtimeMs: 0, remoteSize: r.size, remoteMtimeMs: r.modifiedAt, publishedAt: now }
}

/** Temp file path for downloads during deep compare. */
export function tempDownloadPath(tmpDir: string, i: number): string {
  return join(tmpDir, `compare-${process.pid}-${i}.skyvtmp`)
}

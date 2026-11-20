import type { Manifest } from '../manifest/manifest'
import type { RemoteFile } from '../remote/listTree'
import type { IgnoreMatcher } from '../scan/ignoreRules'

export type DeviationKind = 'missing' | 'changed' | 'server-only'

/** A difference between the server and what Skyv last gave out. */
export interface Deviation {
  path: string
  kind: DeviationKind
  /** Whether the file exists in the site folder on the Mac. */
  existsLocally: boolean
  remoteSize?: number
  remoteModifiedAt?: number
  /** What Skyv expected from the last release (or starting point). */
  expectedSize?: number
  expectedModifiedAt?: number
  /** Pages, stylesheets, scripts or includes on the Mac that use this file. */
  usedBy: string[]
}

export interface DeviationInput {
  manifest: Manifest
  remote: Map<string, RemoteFile>
  /** Paths in the site folder on the Mac (from the last scan). */
  localPaths: Set<string>
  ignore: IgnoreMatcher
  /** True when the server reports exact modification times (MLSD / SFTP). */
  reliableTimes: boolean
  /** Server-only files the user chose to leave alone. */
  dismissed?: Set<string>
  /** Folders that could not be listed: nothing below them is reported as missing. */
  unlistedFolders?: string[]
  usedBy?: Map<string, Set<string>>
}

const TIME_TOLERANCE_MS = 1000
const OWN_TEMP = /(^|\/)\.[^/]+\.[0-9a-f]{8}\.skyvtmp$/

const nfc = (s: string) => s.normalize('NFC')

/**
 * Compare a listing of the server with the manifest and the Mac.
 * - missing: in the manifest, but not on the server.
 * - changed: on both, but the size (or, when reliable, the time) differs from right after the last upload.
 * - server-only: on the server, but neither in the manifest nor on the Mac. Never touched automatically.
 * Ignored files and Skyv's own temporary upload files are never reported.
 */
export function findDeviations(input: DeviationInput): Deviation[] {
  const remoteByKey = new Map<string, RemoteFile>()
  for (const r of input.remote.values()) remoteByKey.set(nfc(r.path), r)
  const localByKey = new Map<string, string>()
  for (const p of input.localPaths) localByKey.set(nfc(p), p)
  const manifestKeys = new Set(Object.keys(input.manifest.files).map(nfc))
  const unlisted = (input.unlistedFolders ?? []).map((f) => nfc(f) + '/')
  const usedBy = (p: string) => [...(input.usedBy?.get(p) ?? [])].sort()

  const out: Deviation[] = []
  for (const [path, entry] of Object.entries(input.manifest.files)) {
    if (input.ignore(path)) continue
    const key = nfc(path)
    const remote = remoteByKey.get(key)
    const existsLocally = localByKey.has(key)
    if (!remote) {
      if (unlisted.some((f) => key.startsWith(f))) continue
      out.push({ path, kind: 'missing', existsLocally, expectedSize: entry.remoteSize ?? entry.size, expectedModifiedAt: entry.remoteMtimeMs, usedBy: usedBy(path) })
      continue
    }
    const expectedSize = entry.remoteSize ?? entry.size
    const sizeDiffers = remote.size !== expectedSize
    const timeDiffers =
      input.reliableTimes &&
      entry.remoteMtimeMs !== undefined &&
      remote.modifiedAt !== undefined &&
      Math.abs(remote.modifiedAt - entry.remoteMtimeMs) > TIME_TOLERANCE_MS
    if (sizeDiffers || timeDiffers) {
      out.push({
        path,
        kind: 'changed',
        existsLocally,
        remoteSize: remote.size,
        remoteModifiedAt: remote.modifiedAt,
        expectedSize,
        expectedModifiedAt: entry.remoteMtimeMs,
        usedBy: usedBy(path)
      })
    }
  }

  for (const r of input.remote.values()) {
    const key = nfc(r.path)
    if (manifestKeys.has(key) || localByKey.has(key)) continue
    if (OWN_TEMP.test(r.path) || input.ignore(r.path)) continue
    if (input.dismissed?.has(r.path) || input.dismissed?.has(key)) continue
    out.push({ path: r.path, kind: 'server-only', existsLocally: false, remoteSize: r.size, remoteModifiedAt: r.modifiedAt, usedBy: usedBy(r.path) })
  }

  const order = { missing: 0, changed: 1, 'server-only': 2 }
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.path.localeCompare(b.path, 'nb'))
}

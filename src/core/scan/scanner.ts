import { promises as fs, createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, sep } from 'node:path'
import type { IgnoreMatcher } from './ignoreRules'

export interface ScannedFile {
  /** Path relative to the site folder, forward slashes, as stored on disk. */
  path: string
  size: number
  mtimeMs: number
  hash: string
}

export interface HashCacheEntry {
  size: number
  mtimeMs: number
  hash: string
}

export type HashCache = Record<string, HashCacheEntry>

export interface ScanWarning {
  path: string
  /** Norwegian explanation. */
  message: string
}

export interface ScanResult {
  files: Map<string, ScannedFile>
  /** Updated cache to persist for next time. */
  cache: HashCache
  warnings: ScanWarning[]
  hashedCount: number
  ignoredCount: number
}

export interface ScanProgress {
  phase: 'listing' | 'hashing'
  done: number
  total: number
}

export interface ScanOptions {
  ignore: IgnoreMatcher
  cache?: HashCache
  onProgress?: (p: ScanProgress) => void
  /** Number of files hashed in parallel. */
  concurrency?: number
  signal?: AbortSignal
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel))
}

/**
 * Walk the site folder and hash every file that is not ignored.
 * - Hashes are reused from `cache` when size and mtime are unchanged.
 * - Symbolic links are followed only if they point to a file inside the site folder.
 * - Never writes anything.
 */
export async function scanFolder(root: string, opts: ScanOptions): Promise<ScanResult> {
  const realRoot = await fs.realpath(root)
  const warnings: ScanWarning[] = []
  const pending: Array<{ path: string; abs: string; size: number; mtimeMs: number }> = []
  let ignoredCount = 0

  const walk = async (dirAbs: string, dirRel: string): Promise<void> => {
    if (opts.signal?.aborted) throw new Error('aborted')
    let entries
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true })
    } catch {
      warnings.push({ path: dirRel || '.', message: 'Mappen kunne ikke leses og blir hoppet over.' })
      return
    }
    for (const e of entries) {
      const rel = dirRel ? `${dirRel}/${e.name}` : e.name
      const abs = join(dirAbs, e.name)
      if (e.isDirectory()) {
        if (opts.ignore(rel, true)) {
          ignoredCount++
          continue
        }
        await walk(abs, rel)
      } else if (e.isFile()) {
        if (opts.ignore(rel)) {
          ignoredCount++
          continue
        }
        const st = await fs.stat(abs).catch(() => null)
        if (st) pending.push({ path: rel, abs, size: st.size, mtimeMs: Math.round(st.mtimeMs) })
      } else if (e.isSymbolicLink()) {
        if (opts.ignore(rel)) {
          ignoredCount++
          continue
        }
        const target = await fs.realpath(abs).catch(() => null)
        if (!target || !isInside(realRoot, target)) {
          warnings.push({ path: rel, message: 'Snarveien peker ut av nettsidens mappe og blir ikke tatt med.' })
          continue
        }
        const st = await fs.stat(target).catch(() => null)
        if (st?.isFile()) pending.push({ path: rel, abs: target, size: st.size, mtimeMs: Math.round(st.mtimeMs) })
        else if (st?.isDirectory()) warnings.push({ path: rel, message: 'Snarveier til mapper blir ikke fulgt.' })
      }
    }
    opts.onProgress?.({ phase: 'listing', done: pending.length, total: 0 })
  }

  await walk(realRoot, '')

  const files = new Map<string, ScannedFile>()
  const cache: HashCache = {}
  let hashedCount = 0
  let done = 0
  const total = pending.length
  const concurrency = opts.concurrency ?? 8
  let next = 0
  let lastReport = 0

  const worker = async () => {
    while (next < pending.length) {
      if (opts.signal?.aborted) throw new Error('aborted')
      const item = pending[next++]
      const cached = opts.cache?.[item.path]
      let hash: string
      if (cached && cached.size === item.size && cached.mtimeMs === item.mtimeMs) {
        hash = cached.hash
      } else {
        try {
          hash = await hashFile(item.abs)
          hashedCount++
        } catch {
          warnings.push({ path: item.path, message: 'Filen kunne ikke leses og blir hoppet over.' })
          done++
          continue
        }
      }
      files.set(item.path, { path: item.path, size: item.size, mtimeMs: item.mtimeMs, hash })
      cache[item.path] = { size: item.size, mtimeMs: item.mtimeMs, hash }
      done++
      const now = Date.now()
      if (now - lastReport > 100 || done === total) {
        lastReport = now
        opts.onProgress?.({ phase: 'hashing', done, total })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, total)) }, worker))

  return { files, cache, warnings, hashedCount, ignoredCount }
}

/** Read `.skyvignore` from the site folder, or "" if missing. */
export async function readSkyvignore(root: string): Promise<string> {
  try {
    return await fs.readFile(join(root, '.skyvignore'), 'utf8')
  } catch {
    return ''
  }
}

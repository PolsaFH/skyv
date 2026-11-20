import { promises as fs } from 'node:fs'
import type { RemoteEntry, RemoteLister } from './types'
import { joinRemote, normalizeRemotePath } from './paths'

/** Folder names web hosts commonly use for the public web root. */
export const COMMON_WEB_ROOTS = ['public_html', 'www', 'htdocs', 'httpdocs', 'web', 'html', 'public', 'wwwroot']

export interface LocalTopLevel {
  files: string[]
  dirs: string[]
}

export interface RootCandidate {
  path: string
  score: number
  /** Short Norwegian reason shown to the user. */
  reason: string
  matched: string[]
  entryCount: number
}

const INDEX_FILES = ['index.html', 'index.htm', 'index.php']

/** Read the top level of the local site folder (hidden files skipped). */
export async function readLocalTopLevel(folder: string): Promise<LocalTopLevel> {
  const entries = await fs.readdir(folder, { withFileTypes: true })
  const files: string[] = []
  const dirs: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'Thumbs.db') continue
    if (e.isDirectory()) dirs.push(e.name)
    else if (e.isFile()) files.push(e.name)
  }
  return { files, dirs }
}

function folded(s: string): string {
  return s.normalize('NFC').toLowerCase()
}

/**
 * Score how well a remote folder listing matches the local site.
 * Index files count most, then other files, then folders. A common web root name gives a bonus.
 */
export function scoreCandidate(path: string, remote: RemoteEntry[], local: LocalTopLevel): RootCandidate {
  const remoteFiles = new Set(remote.filter((e) => e.type === 'file').map((e) => folded(e.name)))
  const remoteDirs = new Set(remote.filter((e) => e.type === 'dir' || e.type === 'link').map((e) => folded(e.name)))
  const matched: string[] = []
  let score = 0
  let possible = 0

  for (const f of local.files) {
    const isIndex = INDEX_FILES.includes(folded(f))
    const weight = isIndex ? 5 : 2
    possible += weight
    if (remoteFiles.has(folded(f))) {
      score += weight
      matched.push(f)
    }
  }
  for (const d of local.dirs) {
    possible += 1
    if (remoteDirs.has(folded(d))) {
      score += 1
      matched.push(d + '/')
    }
  }

  let normalized = possible > 0 ? score / possible : 0
  const base = path.split('/').filter(Boolean).pop() ?? ''
  const commonName = COMMON_WEB_ROOTS.includes(folded(base))
  if (commonName) normalized += 0.15
  if (remote.length === 0 && commonName) normalized += 0.1

  let reason: string
  if (matched.length > 0) {
    const names = matched.slice(0, 3).join(', ')
    reason = `Har ${matched.length} av de samme filene og mappene som på Macen (${names}${matched.length > 3 ? ' …' : ''}).`
  } else if (commonName && remote.length === 0) {
    reason = 'Tom mappe med et navn som webhotell ofte bruker for nettsider.'
  } else if (commonName) {
    reason = 'Navnet er vanlig for nettsider hos webhotell.'
  } else {
    reason = 'Ingen like filer funnet.'
  }

  return { path, score: Math.round(normalized * 1000) / 1000, reason, matched, entryCount: remote.length }
}

export interface DetectOptions {
  /** Where to start looking; usually the folder the server puts you in after login. */
  startDir: string
  /** Site name, e.g. "minside.no", used to look inside folders named after the domain. */
  siteName?: string
  /** Max folders to list (keeps it fast on slow servers). */
  maxListings?: number
}

/**
 * Suggest the remote web root by listing a handful of likely folders and comparing them
 * with the local folder. Returns candidates sorted best first. Never changes anything on the server.
 */
export async function detectRemoteRoot(lister: RemoteLister, local: LocalTopLevel, opts: DetectOptions): Promise<RootCandidate[]> {
  const maxListings = opts.maxListings ?? 20
  let listings = 0
  const listed = new Map<string, RemoteEntry[] | null>()

  const list = async (path: string): Promise<RemoteEntry[] | null> => {
    if (listed.has(path)) return listed.get(path)!
    if (listings >= maxListings) return null
    listings++
    try {
      const entries = await lister.list(path)
      listed.set(path, entries)
      return entries
    } catch {
      listed.set(path, null)
      return null
    }
  }

  const start = normalizeRemotePath(opts.startDir)
  const queue: string[] = [start]
  const domain = opts.siteName ? folded(opts.siteName) : undefined

  // Breadth-first, but only into folders that look relevant: common web roots, the domain name,
  // and typical container folders like "domains" or "sites".
  const containers = new Set(['domains', 'sites', 'vhosts', 'web', 'www', 'httpdocs', 'public_html'])
  const candidates: RootCandidate[] = []
  const seen = new Set<string>()

  while (queue.length > 0 && listings < maxListings) {
    const dir = queue.shift()!
    if (seen.has(dir)) continue
    seen.add(dir)
    const entries = await list(dir)
    if (!entries) continue
    candidates.push(scoreCandidate(dir, entries, local))
    const depth = dir.split('/').filter(Boolean).length
    if (depth >= start.split('/').filter(Boolean).length + 3) continue
    for (const e of entries) {
      if (e.type !== 'dir' && e.type !== 'link') continue
      const n = folded(e.name)
      const interesting =
        COMMON_WEB_ROOTS.includes(n) || containers.has(n) || (domain !== undefined && (n === domain || n === `www.${domain}` || domain === `www.${n}`))
      if (interesting) queue.push(joinRemote(dir, e.name))
    }
  }

  return candidates.sort((a, b) => b.score - a.score || a.path.length - b.path.length)
}

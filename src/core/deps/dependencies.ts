import type { Change } from '../manifest/changes'
import type { Manifest } from '../manifest/manifest'
import type { ScannedFile } from '../scan/scanner'
import type { IgnoreMatcher } from '../scan/ignoreRules'
import { canHaveReferences, extractReferences, resolveReference } from './references'
import { extensionOf } from '../files/fileTypes'

export interface RefProblem {
  /** File that contains the reference. */
  from: string
  line: number
  /** Reference as written. */
  ref: string
  /** Site-relative path it points to. */
  path: string
}

export interface DependencyInfo {
  /** New (never given out) files, and which changed files need them. */
  neededBy: Record<string, string[]>
  /** Points to a file that is not in the site folder. */
  missing: RefProblem[]
  /** Works on the Mac only because macOS ignores upper/lower case; the web server will not find it. */
  caseMismatch: Array<RefProblem & { actual: string }>
  /** Points to a file that exists but is on the ignore list, so it never goes out. */
  ignored: RefProblem[]
}

export interface DependencyInput {
  changes: Change[]
  files: Map<string, ScannedFile>
  manifest: Manifest
  ignore: IgnoreMatcher
  readText: (path: string) => Promise<string | null>
  /** Whether a path exists on disk at all (also ignored files). */
  existsOnDisk: (path: string) => Promise<boolean>
}

const INDEX_NAMES = ['index.html', 'index.htm', 'index.php']

/**
 * Follow references from changed pages, stylesheets, scripts and PHP files.
 * Finds new files that must go out together with them, and references that will break.
 */
export async function analyzeDependencies(input: DependencyInput): Promise<DependencyInfo> {
  const { files, manifest } = input
  const lowerIndex = new Map<string, string>()
  for (const p of files.keys()) lowerIndex.set(p.toLowerCase(), p)

  const info: DependencyInfo = { neededBy: {}, missing: [], caseMismatch: [], ignored: [] }
  const seenProblem = new Set<string>()
  const problem = <T extends RefProblem>(list: T[], p: T, tag: string) => {
    const k = `${tag}:${p.from}:${p.path}`
    if (seenProblem.has(k)) return
    seenProblem.add(k)
    list.push(p)
  }

  const queue = input.changes.filter((c) => c.kind !== 'deleted' && canHaveReferences(c.path)).map((c) => c.path)
  const visited = new Set<string>()

  while (queue.length > 0) {
    const from = queue.shift()!
    if (visited.has(from)) continue
    visited.add(from)
    const text = await input.readText(from)
    if (text === null) continue

    for (const raw of extractReferences(from, text)) {
      const r = resolveReference(from, raw)
      if (!r || r.path === from) continue
      let target: string | null = null
      if (r.isFolder || r.path === '') {
        const base = r.path ? `${r.path}/` : ''
        target = INDEX_NAMES.map((n) => base + n).find((c) => files.has(c)) ?? null
        if (!target) continue // A folder link may be handled by the server; don't guess.
      } else if (files.has(r.path)) {
        target = r.path
      } else {
        const actual = lowerIndex.get(r.path.toLowerCase())
        if (actual) {
          problem(info.caseMismatch, { from, line: r.line, ref: r.ref, path: r.path, actual }, 'case')
          continue
        }
        if (input.ignore(r.path) && (await input.existsOnDisk(r.path))) {
          problem(info.ignored, { from, line: r.line, ref: r.ref, path: r.path }, 'ignored')
          continue
        }
        // "kontakt" without extension is usually a pretty URL handled by the server.
        if (!extensionOf(r.path)) {
          const asFolder = INDEX_NAMES.map((n) => `${r.path}/${n}`).find((c) => files.has(c))
          if (asFolder) target = asFolder
          else continue
        } else {
          problem(info.missing, { from, line: r.line, ref: r.ref, path: r.path }, 'missing')
          continue
        }
      }

      if (target && !manifest.files[target]) {
        const list = (info.neededBy[target] ??= [])
        if (!list.includes(from)) list.push(from)
        if (canHaveReferences(target)) queue.push(target)
      }
    }
  }
  return info
}

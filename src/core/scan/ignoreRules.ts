import ignore from 'ignore'

/** Always ignored, whatever the user configures. */
export const DEFAULT_IGNORE_RULES = [
  '.git',
  '.gitignore',
  '.svn',
  '.hg',
  'node_modules',
  '.DS_Store',
  '._*',
  '.env',
  '.env.*',
  '*.log',
  '.idea',
  '.vscode',
  'Thumbs.db',
  'desktop.ini',
  '.skyvignore',
  '*.skyvtmp',
  // Instructions for AI tools belong on the Mac, never on the web host.
  'CLAUDE.md',
  'AGENTS.md',
  '.claude'
]

export const SOURCE_MAP_RULE = '*.map'

export interface IgnoreOptions {
  /** Rules from the site's settings (gitignore syntax, one per line). */
  siteRules?: string
  /** Contents of `.skyvignore` in the site folder, if any. */
  skyvignore?: string
  ignoreSourceMaps?: boolean
}

export type IgnoreMatcher = (relPath: string, isDir?: boolean) => boolean

/**
 * Build a matcher for paths relative to the site folder (forward slashes).
 * Lines starting with "#" are comments, "!" un-ignores (gitignore syntax).
 */
export function createIgnoreMatcher(opts: IgnoreOptions = {}): IgnoreMatcher {
  const ig = ignore({ ignorecase: true })
  ig.add(DEFAULT_IGNORE_RULES)
  if (opts.ignoreSourceMaps) ig.add(SOURCE_MAP_RULE)
  if (opts.skyvignore) ig.add(opts.skyvignore)
  if (opts.siteRules) ig.add(opts.siteRules)
  return (relPath: string, isDir = false) => {
    const p = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!p) return false
    return ig.ignores(isDir ? `${p}/` : p)
  }
}

/** Validate user-written rules; returns Norwegian messages for lines that look wrong. */
export function checkIgnoreRules(text: string): string[] {
  const problems: string[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    const l = line.trim()
    if (!l || l.startsWith('#')) return
    if (l.includes('..')) problems.push(`Linje ${i + 1}: ".." kan ikke brukes i en regel.`)
    try {
      ignore().add(l)
    } catch {
      problems.push(`Linje ${i + 1}: regelen ser ikke riktig ut.`)
    }
  })
  return problems
}

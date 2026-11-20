import type { Change, ChangeKind } from '../manifest/changes'
import { extensionOf, isImagePath } from '../files/fileTypes'

type Category = 'html' | 'php' | 'css' | 'js' | 'image' | 'font' | 'json' | 'other'

const NOUN: Record<Category, [string, string]> = {
  html: ['HTML-side', 'HTML-sider'],
  php: ['PHP-fil', 'PHP-filer'],
  css: ['CSS-fil', 'CSS-filer'],
  js: ['JavaScript-fil', 'JavaScript-filer'],
  image: ['bilde', 'bilder'],
  font: ['skrift', 'skrifter'],
  json: ['datafil', 'datafiler'],
  other: ['fil', 'filer']
}

const ORDER: Category[] = ['html', 'php', 'css', 'js', 'image', 'font', 'json', 'other']

const VERB: Record<ChangeKind, string> = {
  modified: 'endret',
  added: 'la til',
  deleted: 'slettet',
  renamed: 'ga nytt navn til'
}
const KIND_ORDER: ChangeKind[] = ['modified', 'added', 'deleted', 'renamed']

export function categoryOf(path: string): Category {
  const ext = extensionOf(path)
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'php' || ext === 'phtml' || ext === 'inc') return 'php'
  if (ext === 'css' || ext === 'scss') return 'css'
  if (ext === 'js' || ext === 'mjs') return 'js'
  if (isImagePath(path)) return 'image'
  if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return 'font'
  if (ext === 'json' || ext === 'xml' || ext === 'csv') return 'json'
  return 'other'
}

/** "a", "a og b", "a, b og c" */
export function joinNorwegian(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} og ${parts[parts.length - 1]}`
}

/**
 * Plain Norwegian summary without AI, e.g.
 * "Endret 3 HTML-sider og 1 CSS-fil, la til 2 bilder, slettet 1 fil."
 * Deleted files are counted as plain "filer" (their type matters less).
 */
export function ruleSummary(changes: Pick<Change, 'kind' | 'path'>[]): string {
  if (changes.length === 0) return 'Ingen endringer.'
  const clauses: string[] = []
  for (const kind of KIND_ORDER) {
    const items = changes.filter((c) => c.kind === kind)
    if (items.length === 0) continue
    if (kind === 'deleted' || kind === 'renamed') {
      clauses.push(`${VERB[kind]} ${items.length} ${items.length === 1 ? 'fil' : 'filer'}`)
      continue
    }
    const counts = new Map<Category, number>()
    for (const c of items) counts.set(categoryOf(c.path), (counts.get(categoryOf(c.path)) ?? 0) + 1)
    const parts = ORDER.filter((cat) => counts.has(cat)).map((cat) => {
      const n = counts.get(cat)!
      return `${n} ${NOUN[cat][n === 1 ? 0 : 1]}`
    })
    clauses.push(`${VERB[kind]} ${joinNorwegian(parts)}`)
  }
  const text = clauses.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1) + '.'
}

import { extensionOf } from '../files/fileTypes'
import { extractReferences } from '../deps/references'
import { buildUsedByIndex } from '../deps/usedBy'

const PAGE_EXT = new Set(['html', 'htm', 'php', 'phtml'])
const ASSET_EXT: Record<string, 'image' | 'css' | 'js' | 'font' | 'media'> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', svg: 'image', ico: 'image', bmp: 'image',
  css: 'css',
  js: 'js', mjs: 'js',
  woff: 'font', woff2: 'font', ttf: 'font', otf: 'font', eot: 'font',
  mp4: 'media', webm: 'media', mp3: 'media', ogg: 'media'
}

export const MAX_PAGES = 10
export const MAX_ASSETS = 60

export interface PageToCheck {
  /** Site-relative file. */
  path: string
  /** Why it is checked: it changed, it uses a changed file, or it is the front page as a fallback. */
  reason: 'changed' | 'uses-changed' | 'front-page'
  /** For "uses-changed": the changed file it uses. */
  via?: string
}

/** Public URL for a site file: "index.html" -> "https://x.no/", "om/index.php" -> "https://x.no/om/". */
export function urlFor(siteUrl: string, path: string): string {
  const base = siteUrl.replace(/\/+$/, '')
  const parts = path.split('/')
  const last = parts[parts.length - 1].toLowerCase()
  if (['index.html', 'index.htm', 'index.php'].includes(last)) parts[parts.length - 1] = ''
  return `${base}/${parts.map(encodeURIComponent).join('/')}`
}

function isPagePath(p: string): boolean {
  return PAGE_EXT.has(extensionOf(p))
}

/**
 * Decide which pages to load after a release.
 * - Changed pages are checked directly (unless they are PHP files included by other files).
 * - For changed includes, stylesheets, scripts and images: the pages that use them (following
 *   references in several steps), or the front page if none is found.
 */
export async function pagesToCheck(
  changedPaths: string[],
  allFiles: string[],
  readText: (p: string) => Promise<string | null>
): Promise<PageToCheck[]> {
  const usedBy = await buildUsedByIndex(allFiles, readText)
  const fileSet = new Set(allFiles)

  const isIncluded = (p: string) => {
    if (!['php', 'phtml', 'inc'].includes(extensionOf(p))) return false
    return [...(usedBy.get(p) ?? [])].some((u) => ['php', 'phtml', 'inc'].includes(extensionOf(u)))
  }

  const out: PageToCheck[] = []
  const add = (p: PageToCheck) => {
    if (!out.some((x) => x.path === p.path)) out.push(p)
  }

  for (const changed of changedPaths) {
    if (isPagePath(changed) && !isIncluded(changed)) {
      add({ path: changed, reason: 'changed' })
      continue
    }
    // Walk up to the pages that use this file.
    const seen = new Set<string>([changed])
    const queue = [changed]
    const found: string[] = []
    while (queue.length > 0 && found.length < 3) {
      const cur = queue.shift()!
      for (const u of usedBy.get(cur) ?? []) {
        if (seen.has(u)) continue
        seen.add(u)
        if (isPagePath(u) && !isIncluded(u)) found.push(u)
        else queue.push(u)
      }
    }
    for (const p of found) add({ path: p, reason: 'uses-changed', via: changed })
  }

  const hasCheckablePage = out.length > 0
  const front = ['index.html', 'index.htm', 'index.php'].find((f) => fileSet.has(f))
  if (!hasCheckablePage && front && changedPaths.length > 0) add({ path: front, reason: 'front-page' })
  // Changed pages first, and never too many.
  return out.sort((a, b) => (a.reason === 'changed' ? 0 : 1) - (b.reason === 'changed' ? 0 : 1)).slice(0, MAX_PAGES)
}

export interface FetchResult {
  status: number
  contentType: string
  /** Body text for pages; may be empty for assets. */
  body: string
  /** Final URL after redirects. */
  url: string
}

export type Fetcher = (url: string, opts: { wantBody: boolean }) => Promise<FetchResult>

export interface PageResult {
  path: string
  url: string
  reason: PageToCheck['reason']
  via?: string
  status: number
  ok: boolean
  problems: string[]
}

export interface AssetResult {
  url: string
  usedBy: string
  status: number
  contentType: string
  ok: boolean
  problem?: string
}

export interface PostCheckResult {
  ok: boolean
  checkedAt: string
  pages: PageResult[]
  assets: AssetResult[]
  /** Set when nothing could be checked, with a Norwegian explanation. */
  skipped?: string
  /** True if Skyv undid the release automatically because the check failed. */
  autoUndone?: boolean
}

/** PHP error output as PHP prints it, not ordinary words like "Warning" in content. */
const PHP_ERROR_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /(?:<b>)?(Fatal error|Parse error)(?:<\/b>)?:\s/i, label: 'PHP-feil' },
  { re: /(?:<b>)?(Warning|Notice|Deprecated)(?:<\/b>)?:\s[^\n]{0,400}?\son line\s(?:<b>)?\d+/i, label: 'PHP-advarsel' },
  { re: /Stack trace:/, label: 'Feilspor fra PHP (Stack trace)' },
  { re: /\bUncaught\s+[A-Za-z\\]*(?:Error|Exception)\b/, label: 'Ufanget feil i PHP (Uncaught)' }
]

/**
 * Find PHP error output in a page. Returns at most one short, readable message:
 * "PHP-feil: Uncaught Error: Call to undefined function lag_meny()" (server paths removed).
 */
export function findPhpErrors(body: string): string[] {
  let first: { index: number; label: string } | null = null
  for (const p of PHP_ERROR_PATTERNS) {
    const m = p.re.exec(body)
    if (m && (!first || m.index < first.index)) first = { index: m.index, label: p.label }
  }
  if (!first) return []
  const text = body
    .slice(first.index, first.index + 400)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:PHP\s+)?(?:Fatal error|Parse error|Warning|Notice|Deprecated):\s*/i, '')
    .split(/\s+in\s+\/|\s+in\s+[A-Z]:\\|\s+Stack trace:|\s+thrown in/)[0]
    .trim()
    .slice(0, 160)
  const kind = /Warning|Notice|Deprecated/i.test(body.slice(first.index, first.index + 40)) ? 'PHP-advarsel' : 'PHP-feil'
  return [`${kind}: ${text}`]
}

function contentTypeMatches(kind: (typeof ASSET_EXT)[string], ct: string): boolean {
  const c = ct.toLowerCase()
  if (c.includes('text/html')) return false // An HTML page where a file was expected is an error page.
  if (!c) return true
  switch (kind) {
    case 'image':
      return c.startsWith('image/') || c.includes('octet-stream')
    case 'css':
      return c.includes('text/css') || c.includes('text/plain') || c.includes('octet-stream')
    case 'js':
      return /javascript|ecmascript|text\/plain|octet-stream/.test(c)
    default:
      return true
  }
}

const STATUS_TEXT: Record<number, string> = { 401: 'krever innlogging', 403: 'ingen tilgang', 404: 'finnes ikke', 500: 'feil på serveren', 502: 'serveren svarte ikke', 503: 'serveren er utilgjengelig' }

function describeStatus(status: number): string {
  if (status === 0) return 'fikk ikke kontakt'
  return `svarte ${status}${STATUS_TEXT[status] ? ` (${STATUS_TEXT[status]})` : ''}`
}

/**
 * Load the given pages from the real web address (with a cache-buster) and check them and
 * the images, stylesheets and scripts they use. Never changes anything.
 */
export async function runPostCheck(siteUrl: string, pages: PageToCheck[], fetcher: Fetcher, now = Date.now()): Promise<PostCheckResult> {
  const checkedAt = new Date(now).toISOString()
  if (!siteUrl) return { ok: true, checkedAt, pages: [], assets: [], skipped: 'Nettadressen til siden mangler, så den kunne ikke sjekkes.' }
  if (pages.length === 0) return { ok: true, checkedAt, pages: [], assets: [], skipped: 'Ingen sider å sjekke i denne utgivelsen.' }

  const bust = (u: string) => `${u}${u.includes('?') ? '&' : '?'}skyv=${now.toString(36)}`
  const pageResults: PageResult[] = []
  const assetUrls = new Map<string, { usedBy: string; kind: (typeof ASSET_EXT)[string] }>()
  const origin = new URL(siteUrl).origin

  for (const p of pages) {
    const url = urlFor(siteUrl, p.path)
    let res: FetchResult
    try {
      res = await fetcher(bust(url), { wantBody: true })
    } catch {
      res = { status: 0, contentType: '', body: '', url }
    }
    const problems: string[] = []
    if (res.status < 200 || res.status >= 300) problems.push(`Siden ${describeStatus(res.status)}.`)
    problems.push(...findPhpErrors(res.body))
    pageResults.push({ path: p.path, url, reason: p.reason, via: p.via, status: res.status, ok: problems.length === 0, problems })

    if (res.status >= 200 && res.status < 300 && res.body) {
      for (const raw of extractReferences('side.html', res.body)) {
        const ref = raw.ref.trim()
        if (!ref || /^(data|mailto|tel|javascript|#)/i.test(ref)) continue
        let abs: URL
        try {
          abs = new URL(ref, res.url || url)
        } catch {
          continue
        }
        if (abs.origin !== origin) continue
        const kind = ASSET_EXT[extensionOf(abs.pathname)]
        if (!kind) continue
        abs.hash = ''
        if (!assetUrls.has(abs.toString()) && assetUrls.size < MAX_ASSETS) assetUrls.set(abs.toString(), { usedBy: p.path, kind })
      }
    }
  }

  const assetResults: AssetResult[] = []
  const list = [...assetUrls.entries()]
  let i = 0
  const worker = async () => {
    while (i < list.length) {
      const [url, info] = list[i++]
      let res: FetchResult
      try {
        res = await fetcher(bust(url), { wantBody: false })
      } catch {
        res = { status: 0, contentType: '', body: '', url }
      }
      let problem: string | undefined
      if (res.status < 200 || res.status >= 300) problem = `Filen ${describeStatus(res.status)}.`
      else if (!contentTypeMatches(info.kind, res.contentType)) problem = 'Serveren sendte en nettside i stedet for filen (ofte en feilside for "finnes ikke").'
      assetResults.push({ url, usedBy: info.usedBy, status: res.status, contentType: res.contentType, ok: !problem, problem })
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  assetResults.sort((a, b) => a.url.localeCompare(b.url))

  return { ok: pageResults.every((p) => p.ok) && assetResults.every((a) => a.ok), checkedAt, pages: pageResults, assets: assetResults }
}

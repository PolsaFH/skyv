import { createHash } from 'node:crypto'
import type { Change } from '../manifest/changes'
import type { DependencyInfo } from '../deps/dependencies'
import { extensionOf, isImagePath, isTextPath } from '../files/fileTypes'
import { findSecrets, maskSecret, secretLabel, sensitiveFileKind, SENSITIVE_TEXT } from './secrets'
import type { CheckId, Finding, Severity } from './types'
import { SEVERITY_ORDER } from './types'
import type { PhpLintResult } from '../php/php'

export const LARGE_FILE_BYTES = 10 * 1024 * 1024
export const LARGE_IMAGE_BYTES = 300 * 1024

export interface CheckInput {
  /** The changes that are about to be given out. */
  changes: Change[]
  /** Number of files the site has on the server (from the manifest). */
  publishedCount: number
  /** Number of files in the site folder. */
  localCount: number
  deps: DependencyInfo
  readText: (path: string) => Promise<string | null>
  /** Paths of all text files in the site folder, for "unused image" checks. */
  allTextFiles: string[]
  /** Run `php -l`; undefined when PHP is not installed (the check is then skipped silently). */
  phpLint?: (path: string) => Promise<PhpLintResult>
  /** Paths of changes that are selected (for "needed but not selected"). */
  selectedPaths: Set<string>
}

function fingerprint(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 12)
}

function lineAt(text: string, index: number): number {
  let n = 1
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

class Collector {
  readonly findings: Finding[] = []
  add(severity: Severity, check: CheckId, path: string, message: string, opts: { line?: number; hint?: string; identity?: string } = {}): void {
    this.findings.push({
      key: `${check}:${path}:${fingerprint(opts.identity ?? '')}`,
      severity,
      check,
      path,
      line: opts.line,
      message,
      hint: opts.hint
    })
  }
}

const SCRIPT_LIKE = new Set(['html', 'htm', 'php', 'phtml', 'inc', 'js', 'mjs', 'css'])
const HTML_LIKE = new Set(['html', 'htm', 'php', 'phtml'])

const PLACEHOLDERS: Array<{ re: RegExp; label: string }> = [
  { re: /lorem ipsum|dolor sit amet/gi, label: 'Plassholdertekst ("lorem ipsum")' },
  { re: /\b(?:TODO|FIXME)\b/g, label: 'Notat til utvikler (TODO/FIXME)' },
  { re: /\btest123\b|\basdfgh?\b|\bqwerty\b/gi, label: 'Testtekst' },
  { re: /\b(?:Din tekst her|Skriv tekst her|Your text here|Placeholder text)\b/gi, label: 'Plassholdertekst' }
]

/** Run all checks on the files that are about to be given out. Findings are sorted, most serious first. */
export async function runChecks(input: CheckInput): Promise<Finding[]> {
  const c = new Collector()
  const outgoing = input.changes.filter((ch) => ch.kind !== 'deleted')
  const deletions = input.changes.filter((ch) => ch.kind === 'deleted')

  for (const ch of outgoing) {
    const path = ch.path
    const ext = extensionOf(path)

    // Sensitive files
    const sk = sensitiveFileKind(path)
    if (sk) c.add('block', 'sensitive-file', path, SENSITIVE_TEXT[sk], { hint: 'Fjern krysset, eller legg filen til i ignorer-reglene.' })

    if (ch.size > LARGE_FILE_BYTES) {
      c.add('warn', 'large-file', path, `Filen er veldig stor (${Math.round(ch.size / 1024 / 1024)} MB). Det tar tid å laste opp, og gjør siden treg hvis den vises.`, {
        hint: isImagePath(path) ? 'Gjør bildet mindre før du gir det ut.' : undefined
      })
    }

    if (isImagePath(path) && ext !== 'svg' && ch.size > LARGE_IMAGE_BYTES && ch.size <= LARGE_FILE_BYTES) {
      const base = path.slice(path.lastIndexOf('/') + 1)
      let used = false
      for (const t of input.allTextFiles) {
        if (t === path) continue
        const text = await input.readText(t)
        if (text?.includes(base)) {
          used = true
          break
        }
      }
      if (!used) c.add('info', 'unused-image', path, `Stort bilde (${Math.round(ch.size / 1024)} kB) som ingen side ser ut til å bruke.`, { hint: 'Kanskje det ikke trengs på nettsiden?' })
    }

    if (!isTextPath(path)) continue
    const text = await input.readText(path)
    if (text === null) continue

    // Secrets
    for (const s of findSecrets(path, text)) {
      const check: CheckId = s.kind === 'db-password' ? 'db-password' : s.kind === 'private-key' ? 'private-key' : 'secret'
      const shown = maskSecret(s.kind, s.value)
      const hint =
        s.kind === 'google'
          ? 'Hvis dette er en Google Maps-nøkkel som skal være offentlig, og den er begrenset til nettsiden din, kan du ignorere funnet.'
          : s.kind === 'db-password'
            ? 'PHP-sider trenger ofte passordet på serveren. Er du sikker på at filen skal ut, kan du ignorere funnet for denne nettsiden.'
            : 'Fjern nøkkelen fra filen, og lag en ny nøkkel hos tjenesten hvis den allerede har vært offentlig.'
      c.add('block', check, path, `${secretLabel(s.kind)} ligger i filen (${shown}). Alle som besøker nettsiden kan finne den.`, {
        line: lineAt(text, s.index),
        hint,
        identity: s.kind + s.value
      })
    }

    if (SCRIPT_LIKE.has(ext)) {
      // Links to this computer or the local network
      const local = /(?:https?:)?\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?[^\s"'<>)]*|file:\/\/[^\s"'<>)]*/gi
      for (const m of text.matchAll(local)) {
        c.add('warn', 'local-link', path, `Lenke til din egen maskin eller ditt lokale nettverk: ${m[0].slice(0, 60)}. Den virker ikke for besøkende.`, {
          line: lineAt(text, m.index!),
          identity: m[0]
        })
      }

      // Placeholder and test text
      for (const p of PLACEHOLDERS) {
        const m = p.re.exec(text)
        p.re.lastIndex = 0
        if (m) {
          const count = (text.match(p.re) ?? []).length
          c.add('warn', 'placeholder-text', path, `${p.label}: "${m[0]}"${count > 1 ? ` (${count} steder)` : ''}.`, { line: lineAt(text, m.index), identity: p.label })
        }
      }
    }

    // console.log in scripts
    if (ext === 'js' || ext === 'mjs' || HTML_LIKE.has(ext)) {
      const re = /\bconsole\.(?:log|debug)\s*\(/g
      const first = re.exec(text)
      if (first) {
        const count = (text.match(/\bconsole\.(?:log|debug)\s*\(/g) ?? []).length
        c.add('info', 'console-log', path, `console.log brukes ${count === 1 ? 'ett sted' : `${count} steder`}. Det er feilsøking som besøkende ikke trenger.`, { line: lineAt(text, first.index) })
      }
    }

    if (HTML_LIKE.has(ext)) {
      // Images without alt text
      const imgs = [...text.matchAll(/<img\b(?![^>]*\balt\s*=)[^>]*>/gi)]
      if (imgs.length > 0) {
        c.add('info', 'missing-alt', path, `${imgs.length === 1 ? 'Ett bilde' : `${imgs.length} bilder`} mangler alt-tekst. Den hjelper blinde og svaksynte, og søkemotorer.`, {
          line: lineAt(text, imgs[0].index!)
        })
      }
      // Full documents without <title>
      if (/<html[\s>]|<head[\s>]/i.test(text) && !/<title[\s>]/i.test(text)) {
        c.add('info', 'missing-title', path, 'Siden mangler <title>. Tittelen vises i fanen i nettleseren og i søkeresultater.')
      }
    }

    // PHP syntax
    if ((ext === 'php' || ext === 'phtml' || ext === 'inc') && input.phpLint && ext !== 'inc') {
      const r = await input.phpLint(path)
      if (!r.ok) c.add('warn', 'php-syntax', path, `PHP-feil: ${r.message ?? 'filen kunne ikke leses av PHP'}. Siden kan vise en feilmelding eller være blank.`, { line: r.line, identity: r.message })
    }

    // JSON
    if (ext === 'json' || ext === 'webmanifest') {
      try {
        JSON.parse(text)
      } catch (err) {
        const pos = /position (\d+)/.exec(String((err as Error).message))
        const line = pos ? lineAt(text, Number(pos[1])) : undefined
        c.add('warn', 'invalid-json', path, 'Filen er ikke gyldig JSON. Det som leser den, vil feile.', { line })
      }
    }
  }

  // References that will break (from the dependency scan), only for files going out.
  for (const m of input.deps.missing) {
    if (!input.selectedPaths.has(m.from)) continue
    c.add('warn', 'broken-link', m.from, `Peker på ${m.ref}, som ikke finnes i mappen.`, { line: m.line, identity: m.path })
  }
  for (const m of input.deps.caseMismatch) {
    if (!input.selectedPaths.has(m.from)) continue
    c.add('warn', 'broken-link', m.from, `Peker på ${m.ref}, men filen heter ${m.actual}. Det virker på Macen, men ikke på webhotellet, der store og små bokstaver er forskjellige.`, {
      line: m.line,
      identity: m.path
    })
  }
  for (const m of input.deps.ignored) {
    if (!input.selectedPaths.has(m.from)) continue
    c.add('warn', 'broken-link', m.from, `Bruker ${m.ref}, men den filen står på listen over filer som aldri lastes opp.`, { line: m.line, identity: m.path })
  }
  for (const [needed, by] of Object.entries(input.deps.neededBy)) {
    if (input.selectedPaths.has(needed)) continue
    const users = by.filter((b) => input.selectedPaths.has(b))
    if (users.length === 0) continue
    c.add('warn', 'not-selected', needed, `Er ikke valgt, men brukes av ${users.join(', ')} og finnes ikke på serveren ennå.`, { identity: users.join(',') })
  }

  // Unusually large releases
  if (input.publishedCount > 0) {
    const share = deletions.length / input.publishedCount
    if (deletions.length > 10 || (deletions.length > 2 && share > 0.3)) {
      c.add('warn', 'many-deletions', '', `Uvanlig mange slettinger: ${deletions.length} filer (${Math.round(share * 100)} % av nettsiden).`, {
        hint: 'Sjekk at mappen på Macen er riktig, og at filene ikke er flyttet ved en feil.'
      })
    }
    if (input.changes.length > 20 && input.changes.length > input.localCount * 0.5) {
      c.add('warn', 'many-changes', '', `Uvanlig mange endringer: ${input.changes.length} av ${input.localCount} filer.`, {
        hint: 'Det kan være riktig, men sjekk at det ikke er en feil mappe eller en hel kopi av siden.'
      })
    }
  }

  return c.findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.path.localeCompare(b.path, 'nb') || (a.line ?? 0) - (b.line ?? 0))
}

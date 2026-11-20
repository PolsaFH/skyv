import type { Change } from '../manifest/changes'
import type { TextDiff } from '../diff/textDiff'
import { findSecrets, sensitiveFileKind } from '../checks/secrets'
import { isTextPath } from '../files/fileTypes'
import { ruleSummary } from './ruleSummary'

export const MAX_LINES_PER_FILE = 40
export const MAX_TOTAL_CHARS = 12000

export interface AiPayloadFile {
  path: string
  kind: Change['kind']
  /** Only changed lines, prefixed with "+" (added) or "-" (removed). */
  lines: string[]
  /** Set when lines were left out on purpose, with the reason in Norwegian. */
  omitted?: string
}

export interface AiPayload {
  /** The overview line (rule-based summary) that gives the model context. */
  overview: string
  files: AiPayloadFile[]
}

/** Lines that look like keys or passwords are replaced before anything leaves the Mac. */
function scrubLine(path: string, line: string): string {
  return findSecrets(path.endsWith('.php') ? path : `${path}.php`, line).length > 0 ? '[linje med hemmelig verdi fjernet]' : line
}

/**
 * Build exactly what will be sent to the AI: only changed lines of text files.
 * Files with a secret finding (or sensitive files like .env) are listed by name only.
 */
export async function buildAiPayload(
  changes: Change[],
  getDiff: (c: Change) => Promise<TextDiff | null>,
  secretPaths: Set<string>
): Promise<AiPayload> {
  const files: AiPayloadFile[] = []
  let total = 0
  for (const c of changes) {
    const f: AiPayloadFile = { path: c.path, kind: c.kind, lines: [] }
    files.push(f)
    if (c.kind === 'deleted' || c.kind === 'renamed') continue
    if (secretPaths.has(c.path) || sensitiveFileKind(c.path)) {
      f.omitted = 'Innholdet sendes ikke, fordi Skyv fant noe hemmelig i filen.'
      continue
    }
    if (!isTextPath(c.path)) {
      f.omitted = 'Ikke en tekstfil.'
      continue
    }
    const diff = await getDiff(c)
    if (!diff) continue
    for (const r of diff.rows) {
      if (r.kind !== 'added' && r.kind !== 'removed') continue
      if (f.lines.length >= MAX_LINES_PER_FILE || total > MAX_TOTAL_CHARS) {
        f.omitted = 'Resten av endringene er kuttet for å holde det kort.'
        break
      }
      const line = `${r.kind === 'added' ? '+' : '-'} ${scrubLine(c.path, r.text).slice(0, 300)}`
      f.lines.push(line)
      total += line.length
    }
  }
  return { overview: ruleSummary(changes), files }
}

/** The text shown to the user ("dette blir sendt") and sent to the model, identical. */
export function payloadText(p: AiPayload): string {
  const parts = [`Oversikt: ${p.overview}`]
  for (const f of p.files) {
    const label = { added: 'ny', modified: 'endret', deleted: 'slettet', renamed: 'omdøpt' }[f.kind]
    parts.push(`\n### ${f.path} (${label})`)
    if (f.lines.length > 0) parts.push(f.lines.join('\n'))
    if (f.omitted) parts.push(`(${f.omitted})`)
  }
  return parts.join('\n')
}

export const AI_INSTRUCTIONS =
  'Du skriver et kort notat på norsk bokmål om hva som er endret på en nettside, til eieren av siden, som ikke er utvikler. ' +
  'Skriv én eller to setninger om hva besøkende vil merke (innhold, utseende, nye sider), ikke om filnavn eller kode. ' +
  'Ikke bruk fagord som commit, diff, push eller deploy. Ikke bruk tankestreker. Svar bare med notatet.'

/** Minimal shape of the model call, so the core can be tested without the network. */
export type ModelCall = (system: string, user: string) => Promise<string>

export async function aiSummary(payload: AiPayload, call: ModelCall): Promise<string> {
  const text = (await call(AI_INSTRUCTIONS, payloadText(payload))).trim()
  return text.replace(/\s+—\s+/g, ', ').replace(/—/g, '-')
}

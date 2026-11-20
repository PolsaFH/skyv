import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export const SKYV_START = '<!-- skyv:start -->'
export const SKYV_END = '<!-- skyv:slutt -->'
export const INSTRUCTIONS_FILE = 'CLAUDE.md'

/** The Skyv section for CLAUDE.md, in Norwegian (it is read by the AI and by the user). */
export function skyvSection(siteName: string): string {
  return [
    SKYV_START,
    '## Utgivelse med Skyv',
    '',
    `Denne mappen gis ut til webhotellet med Skyv. Nettsiden heter «${siteName}» i Skyv. Skyv oppdaterer teksten mellom skyv-markørene, så skriv egne notater utenfor dem.`,
    '',
    '- Når du er ferdig med endringer, bruk Skyv: kjør `skyv_run_checks`, rett funnene du kan rette, se på resultatet med `skyv_screenshot`, og klargjør en utgivelse med `skyv_prepare_release` og et kort, tydelig notat.',
    '- Be brukeren trykke "Gi ut" i Skyv. Gi aldri ut uten at brukeren har sagt ja, med mindre nettsiden har nivå 3 ("Se, klargjøre og gi ut").',
    '- Be aldri brukeren om å ignorere røde funn eller slå av sjekker. Rett feilen i stedet.',
    '- Ikke legg hemmeligheter i koden. Bruk miljøvariabler eller filer som er på ignorer-listen.',
    '- Hvis sjekken etter opplasting feiler: les feilen (`skyv_get_last_health_check`), rett filen lokalt og klargjør en ny utgivelse. Foreslå angring med `skyv_request_undo` hvis siden er nede.',
    SKYV_END
  ].join('\n')
}

function findSection(text: string): { start: number; end: number } | null {
  const start = text.indexOf(SKYV_START)
  if (start < 0) return null
  const endMarker = text.indexOf(SKYV_END, start)
  if (endMarker < 0) return null
  return { start, end: endMarker + SKYV_END.length }
}

export function hasSection(text: string | null): boolean {
  return text !== null && findSection(text) !== null
}

/** Add the section, or replace the one between the markers. Everything outside the markers is kept as is. */
export function upsertSection(existing: string | null, section: string): string {
  if (existing === null || existing.trim() === '') return `${section}\n`
  const found = findSection(existing)
  if (found) return existing.slice(0, found.start) + section + existing.slice(found.end)
  const sep = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
  return `${existing}${sep}${section}\n`
}

/** Remove the section (and the blank line Skyv put before it). Everything else is kept as is. */
export function removeSection(existing: string): string {
  const found = findSection(existing)
  if (!found) return existing
  let before = existing.slice(0, found.start)
  let after = existing.slice(found.end)
  if (after.startsWith('\n')) after = after.slice(1)
  if (after === '' && before.endsWith('\n\n')) before = before.slice(0, -1)
  return before + after
}

export type InstructionsState = 'none' | 'present'

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** Whether the site folder's CLAUDE.md has a Skyv section. */
export async function instructionsState(localPath: string): Promise<InstructionsState> {
  return hasSection(await readOrNull(join(localPath, INSTRUCTIONS_FILE))) ? 'present' : 'none'
}

/** Create or update the Skyv section in CLAUDE.md in the site folder. */
export async function writeInstructions(localPath: string, siteName: string): Promise<void> {
  const file = join(localPath, INSTRUCTIONS_FILE)
  const next = upsertSection(await readOrNull(file), skyvSection(siteName))
  await fs.writeFile(file, next, 'utf8')
}

/**
 * Remove the Skyv section. If nothing else is left in the file, it goes to the Trash via `trash`
 * (never deleted for good); without `trash` the empty file is kept.
 */
export async function removeInstructions(localPath: string, trash?: (path: string) => Promise<void>): Promise<void> {
  const file = join(localPath, INSTRUCTIONS_FILE)
  const cur = await readOrNull(file)
  if (cur === null || !hasSection(cur)) return
  const next = removeSection(cur)
  if (next.trim() === '' && trash) await trash(file)
  else await fs.writeFile(file, next, 'utf8')
}

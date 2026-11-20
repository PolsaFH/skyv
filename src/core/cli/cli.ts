import { resolve, sep } from 'node:path'
import type { ApiResponse } from '../agentApi/api'

export interface CliDeps {
  call: (method: string, params?: Record<string, unknown>) => Promise<ApiResponse>
  cwd: string
  out: (text: string) => void
  err: (text: string) => void
}

const HELP = `skyv: gi ut nettsider med Skyv fra Terminal

Bruk:
  skyv status [nettside]              Oversikt (alle nettsider, eller én)
  skyv changes [nettside] [--diff]    Endringer siden forrige utgivelse
  skyv check [nettside] [filer …]     Kjør sjekkene før utgivelse
  skyv history [nettside] [-n 10]     Tidligere utgivelser
  skyv prepare [nettside] -m "notat" [filer …]
                                      Klargjør en utgivelse som du godkjenner i Skyv
  skyv release [nettside] [utkast-id] Gi ut et klargjort utkast (bare med nivået "Se, klargjøre og gi ut")
  skyv undo [nettside] <utgivelse-id> -m "begrunnelse"
                                      Be om at en utgivelse angres (godkjennes i Skyv)

Står du i mappen til en nettside, trenger du ikke skrive navnet.
Legg til --json for maskinlesbart svar.
Tillatelsene settes i Skyv under Innstillinger → AI-tilkobling, og gjelder også her.`

interface Parsed {
  cmd: string
  positional: string[]
  flags: Record<string, string | boolean>
}

export function parseArgs(argv: string[]): Parsed {
  const [cmd = 'help', ...rest] = argv
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '-m' || a === '--message' || a === '--note' || a === '-n') {
      flags[a === '-n' ? 'n' : 'm'] = rest[++i] ?? ''
    } else if (a.startsWith('--')) flags[a.slice(2)] = true
    else positional.push(a)
  }
  return { cmd, positional, flags }
}

type SiteRow = { id: string; name: string; local_folder: string; pending_changes: number; server_deviations: number; permission: string }

/**
 * The `skyv` command. Every command is an API call with the same permissions as for MCP.
 * Returns the exit code (0 ok, 1 refused or failed, 2 usage error).
 */
export async function runCli(argv: string[], d: CliDeps): Promise<number> {
  const { cmd, positional, flags } = parseArgs(argv)
  const json = flags.json === true
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    d.out(HELP)
    return 0
  }
  const known = ['status', 'changes', 'check', 'history', 'prepare', 'release', 'undo']
  if (!known.includes(cmd)) {
    d.err(`Ukjent kommando: ${cmd}\n\n${HELP}`)
    return 2
  }

  const call = async (method: string, params: Record<string, unknown> = {}): Promise<Record<string, any> | null> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await d.call(method, params)
    if (!r.ok) {
      d.err(`${r.error.message}${r.error.hint ? `\n${r.error.hint}` : ''}`)
      return null
    }
    return r.result as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  // Which site? Explicit name, else the site whose folder we are in, else the only site.
  const sitesRes = await call('skyv_list_sites')
  if (!sitesRes) return 1
  const sites = sitesRes.sites as SiteRow[]
  const byName = (n: string) => sites.find((s) => s.name.toLowerCase() === n.toLowerCase() || s.id === n)
  const here = sites.find((s) => s.local_folder && (resolve(d.cwd) + sep).startsWith(resolve(s.local_folder) + sep))

  const pickSite = (args: string[], required: boolean): string | null | undefined => {
    if (args[0] && byName(args[0])) return byName(args.shift()!)!.name
    if (here) return here.name
    // "skyv status" outside a site folder shows the overview; other commands may use the only site.
    if (sites.length === 1 && required) return sites[0].name
    if (!required) return undefined
    d.err(sites.length === 0 ? 'Skyv har ingen nettsider ennå.' : `Skriv hvilken nettside: ${sites.map((s) => s.name).join(', ')}`)
    return null
  }

  const args = [...positional]
  const emit = (data: unknown, text: () => string) => d.out(json ? JSON.stringify(data, null, 2) : text())

  switch (cmd) {
    case 'status': {
      const site = pickSite(args, false)
      if (site === null) return 2
      if (site === undefined) {
        emit(sitesRes, () =>
          sites.length === 0
            ? 'Skyv har ingen nettsider ennå.'
            : sites.map((s) => `${s.name}: ${s.pending_changes} endringer${s.server_deviations ? `, ${s.server_deviations} avvik på serveren` : ''} (${s.permission})`).join('\n')
        )
        return 0
      }
      const r = await call('skyv_get_status', { site })
      if (!r) return 1
      emit(r, () => {
        const c = r.changes
        const lines = [
          `${r.site.name} (${r.site.permission})`,
          `Endringer: ${c.total} (${c.added} nye, ${c.modified} endret, ${c.deleted} slettet, ${c.renamed} omdøpt)`,
          `Funn: ${r.findings_for_default_selection.blocking} alvorlige, ${r.findings_for_default_selection.warnings} advarsler, ${r.findings_for_default_selection.tips} tips`
        ]
        if (r.server_deviations) {
          const sd = r.server_deviations
          lines.push(`Serveren: ${sd.missing_on_server} mangler, ${sd.changed_on_server} endret, ${sd.only_on_server} bare på serveren`)
        }
        for (const dr of r.drafts) lines.push(`Utkast ${dr.draft_id}: ${dr.files} filer, "${dr.note}"`)
        if (r.last_release) lines.push(`Forrige utgivelse: ${r.last_release.at} (${r.last_release.status})`)
        return lines.join('\n')
      })
      return 0
    }
    case 'changes': {
      const site = pickSite(args, true)
      if (!site) return 2
      const r = await call('skyv_get_changes', { site, include_diffs: flags.diff === true })
      if (!r) return 1
      emit(r, () => {
        if (r.changes.length === 0) return 'Alt er oppdatert.'
        return r.changes
          .map((c: { kind: string; path: string; from: string | null; diff?: { lines?: { untrusted_content: string }; hidden?: string } }) => {
            const label = { added: 'ny', modified: 'endret', deleted: 'slettet', renamed: 'omdøpt' }[c.kind] ?? c.kind
            const head = `${label.padEnd(8)} ${c.path}${c.from ? ` (fra ${c.from})` : ''}`
            const body = c.diff?.hidden ? `\n    ${c.diff.hidden}` : c.diff?.lines ? `\n${c.diff.lines.untrusted_content.replace(/^/gm, '    ')}` : ''
            return head + body
          })
          .join('\n')
      })
      return 0
    }
    case 'check': {
      const site = pickSite(args, true)
      if (!site) return 2
      const r = await call('skyv_run_checks', { site, files: args.length > 0 ? args : undefined })
      if (!r) return 1
      emit(r, () => {
        if (r.findings.length === 0) return `Ingen problemer funnet i ${r.files_checked.length} filer.`
        const icon: Record<string, string> = { blocking: 'STOPP', warning: 'Advarsel', tip: 'Tips' }
        return r.findings.map((f: { severity: string; file: string | null; line: number | null; message: string }) => `${icon[f.severity]}: ${f.file ?? ''}${f.line ? `:${f.line}` : ''} ${f.message}`).join('\n')
      })
      return r.blocking > 0 ? 1 : 0
    }
    case 'history': {
      const site = pickSite(args, true)
      if (!site) return 2
      const r = await call('skyv_list_releases', { site, limit: Number(flags.n) || 10 })
      if (!r) return 1
      emit(r, () =>
        r.releases.length === 0
          ? 'Ingen utgivelser ennå.'
          : r.releases.map((x: { id: string; at: string; status: string; files: number; note: string | null }) => `${x.at}  ${x.status.padEnd(10)} ${x.files} filer  ${x.note ?? ''}\n  id: ${x.id}`).join('\n')
      )
      return 0
    }
    case 'prepare': {
      const site = pickSite(args, true)
      if (!site) return 2
      const r = await call('skyv_prepare_release', { site, note: typeof flags.m === 'string' ? flags.m : undefined, files: args.length > 0 ? args : undefined })
      if (!r) return 1
      emit(r, () => `Utkast klargjort (${r.files.length} filer): ${r.draft_id}\nNotat: ${r.note}\n${r.ready_to_release ? 'Klar. Godkjenn og gi ut i Skyv.' : 'Sjekkene fant alvorlige problemer. Rett dem, og klargjør på nytt.'}`)
      return r.ready_to_release ? 0 : 1
    }
    case 'release': {
      const site = pickSite(args, true)
      if (!site) return 2
      let draftId = args[0]
      if (!draftId) {
        const st = await call('skyv_get_status', { site })
        if (!st) return 1
        draftId = st.drafts[0]?.draft_id
        if (!draftId) {
          d.err('Det finnes ikke noe klargjort utkast. Bruk "skyv prepare" først.')
          return 1
        }
      }
      const r = await call('skyv_release_draft', { site, draft_id: draftId })
      if (!r) return 1
      emit(r, () =>
        r.released
          ? `Gitt ut: ${r.release.files} filer (${r.release.status}).${r.health_check && !r.health_check.ok && !r.health_check.skipped ? '\nSjekken av nettsiden fant feil. Se Skyv.' : ''}`
          : `Ikke gitt ut:\n${r.problems.map((p: string) => `- ${p}`).join('\n')}`
      )
      return r.released ? 0 : 1
    }
    case 'undo': {
      const site = pickSite(args, true)
      if (!site) return 2
      const releaseId = args[0]
      if (!releaseId || typeof flags.m !== 'string') {
        d.err('Bruk: skyv undo [nettside] <utgivelse-id> -m "begrunnelse"')
        return 2
      }
      const r = await call('skyv_request_undo', { site, release_id: releaseId, reason: flags.m })
      if (!r) return 1
      emit(r, () => 'Forespørselen om å angre er sendt. Godkjenn den i Skyv.')
      return 0
    }
  }
  return 2
}

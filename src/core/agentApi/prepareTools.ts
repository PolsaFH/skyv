import { changeKey, type Change } from '../manifest/changes'
import type { ChangeSet } from '../workspace'
import type { Site } from '../types'
import { ruleSummary } from '../summary/ruleSummary'
import { UserError } from '../errors'
import type { Finding } from '../checks/types'
import type { AgentApi } from './api'
import type { AgentServices } from './methods'
import { defaultSelection } from './methods'
import { DraftStore, DRAFT_MAX_AGE_MS, type Draft, type DraftFile, type UndoRequest } from './drafts'
import { findingForAgent, healthFailuresForAgent, healthNextStep, releaseSummary } from './readTools'
import { limitReply } from './content'

export interface DraftEvents {
  /** A draft was created, changed, discarded or released. */
  draftsChanged?: (siteId: string, newDraft?: Draft) => void
  /** The AI asked the user to undo a release. */
  undoRequested?: (siteId: string, request: UndoRequest) => void
}

export function draftStoreFor(s: AgentServices, siteId: string): DraftStore {
  return new DraftStore(s.sites.store.siteDir(siteId))
}

/** Add new files that the selected files need (same rule as the change list in the app). */
export function withNeeded(selected: Change[], cs: ChangeSet): { changes: Change[]; neededBy: Map<string, string[]> } {
  const out = [...selected]
  const neededBy = new Map<string, string[]>()
  let grew = true
  while (grew) {
    grew = false
    const paths = new Set(out.map((c) => c.path))
    for (const [needed, by] of Object.entries(cs.deps.neededBy)) {
      if (paths.has(needed)) continue
      const users = by.filter((b) => paths.has(b))
      const change = cs.changes.find((c) => c.path === needed && c.kind !== 'deleted')
      if (users.length > 0 && change) {
        out.push(change)
        neededBy.set(needed, users)
        grew = true
      }
    }
  }
  return { changes: out, neededBy }
}

/** Pick the changes for a draft: given paths (never deletions), or the default selection, plus needed files. */
function selectChanges(cs: ChangeSet, files: unknown): { changes: Change[]; neededBy: Map<string, string[]> } {
  if (cs.needsStartingPoint || cs.needsCompare) throw new UserError('Nettsiden mangler utgangspunkt. Brukeren må velge det i Skyv først.')
  let selected: Change[]
  if (Array.isArray(files) && files.length > 0) {
    const wanted = files.filter((f): f is string => typeof f === 'string').map((f) => f.replace(/^\/+/, ''))
    selected = []
    const missing: string[] = []
    for (const p of wanted) {
      const c = cs.changes.find((x) => x.path === p || x.from === p)
      if (!c) missing.push(p)
      else if (c.kind === 'deleted') {
        throw new UserError(`${p} er slettet på Macen. Slettinger kan bare velges av brukeren i Skyv.`, 'Ta den ut av listen, eller be brukeren gi ut slettingen selv.')
      } else if (!selected.includes(c)) selected.push(c)
    }
    if (missing.length > 0) throw new UserError(`Disse filene har ingen endringer: ${missing.join(', ')}.`, 'Bruk skyv_get_changes for å se hva som er endret.')
  } else {
    selected = defaultSelection(cs)
  }
  if (selected.length === 0) throw new UserError('Det er ingen endringer å gi ut.')
  return withNeeded(selected, cs)
}

function toDraftFiles(changes: Change[], neededBy: Map<string, string[]>): DraftFile[] {
  return changes.map((c) => ({ key: changeKey(c), path: c.path, kind: c.kind, from: c.from, hash: c.hash, neededBy: neededBy.get(c.path) }))
}

function summarize(findings: Finding[]) {
  return {
    blocking: findings.filter((f) => f.severity === 'block').length,
    warnings: findings.filter((f) => f.severity === 'warn').length,
    tips: findings.filter((f) => f.severity === 'info').length
  }
}

export interface DraftValidation {
  ok: boolean
  /** Norwegian reasons why the draft cannot be given out as it is. */
  problems: string[]
  /** Files changed since the draft was made. */
  stale: boolean
  changes: Change[]
  findings: Finding[]
}

/**
 * Check whether a draft can be given out right now. Used both for skyv_release_draft and when the
 * user presses "Gi ut" in the draft band. All the hard stops live here:
 * open and younger than 24 hours, no deletions, files unchanged since the draft, no blocking
 * findings, no conflicts on the server, and no unhandled server deviations for the files.
 */
export async function validateDraft(s: AgentServices, site: Site, draft: Draft, now = Date.now()): Promise<DraftValidation> {
  const problems: string[] = []
  if (draft.status !== 'open') problems.push(draft.status === 'released' ? 'Utkastet er allerede gitt ut.' : 'Utkastet er forkastet.')
  if (now - Date.parse(draft.createdAt) > DRAFT_MAX_AGE_MS) problems.push('Utkastet er eldre enn 24 timer.')
  if (draft.files.some((f) => f.kind === 'deleted')) problems.push('Utkastet inneholder slettinger, som bare brukeren kan gi ut.')

  const cs = await s.workspaces.scan(site.id)
  const byKey = new Map(cs.changes.map((c) => [changeKey(c), c]))
  let stale = false
  const current: Change[] = []
  for (const f of draft.files) {
    const c = byKey.get(f.key)
    if (!c || c.hash !== f.hash) stale = true
    const now_ = c ?? cs.changes.find((x) => x.path === f.path && x.kind !== 'deleted')
    if (now_) current.push(now_)
  }
  if (stale) problems.push('Filene har endret seg siden utkastet ble klargjort.')

  const { findings } = current.length > 0 ? await s.checks.run(site.id, current.map(changeKey)) : { findings: [] }
  const blocking = findings.filter((f) => f.severity === 'block').length
  if (blocking > 0) problems.push(`Sjekkene fant ${blocking === 1 ? 'et alvorlig problem' : `${blocking} alvorlige problemer`} (røde funn).`)

  if (problems.length === 0) {
    const conflicts = await s.releases.check(site.id, current.map(changeKey))
    if (conflicts.length > 0) problems.push(`${conflicts.length === 1 ? 'En fil' : `${conflicts.length} filer`} er endret på serveren siden forrige utgivelse: ${conflicts.map((c) => c.path).join(', ')}.`)
    const deviating = new Set(((await s.serverCheck.last(site.id))?.deviations ?? []).map((d) => d.path))
    const hit = current.filter((c) => deviating.has(c.path) || (c.from && deviating.has(c.from)))
    if (hit.length > 0) problems.push(`Serversjekken har ubehandlede avvik for ${hit.map((c) => c.path).join(', ')}.`)
  }
  return { ok: problems.length === 0, problems, stale, changes: current, findings }
}

function draftForAgent(d: Draft) {
  return {
    draft_id: d.id,
    created_at: d.createdAt,
    created_by: d.createdBy,
    status: d.status,
    note: d.note,
    files: d.files.map((f) => ({ path: f.path, kind: f.kind, from: f.from ?? null, included_because_needed_by: f.neededBy ?? null })),
    findings: d.findings
  }
}

const NEXT_STEP_USER = 'Ask the user to review the draft and press "Gi ut" in Skyv. Do not release without the user\'s consent.'
const NEXT_STEP_LEVEL3 = 'The user allows you to release this site. Only call skyv_release_draft if the user has agreed to release now.'

/** Register the tools for level "Se og klargjøre" and "Se, klargjøre og gi ut". */
export function registerPrepareTools(api: AgentApi, s: AgentServices, events: DraftEvents = {}): void {
  api.register('skyv_prepare_release', {
    level: 'prepare',
    needsSite: true,
    handler: async (params, ctx) => {
      const site = ctx.site!
      const cs = await s.workspaces.scan(site.id)
      const { changes, neededBy } = selectChanges(cs, params.files)
      const { findings } = await s.checks.run(site.id, changes.map(changeKey))
      const note = typeof params.note === 'string' && params.note.trim() ? params.note.trim().slice(0, 2000) : ruleSummary(changes)
      const draft = await draftStoreFor(s, site.id).create({
        siteId: site.id,
        createdBy: ctx.client.name,
        note,
        files: toDraftFiles(changes, neededBy),
        findings: summarize(findings)
      })
      events.draftsChanged?.(site.id, draft)
      const blocking = findings.some((f) => f.severity === 'block')
      return limitReply({
        ...draftForAgent(draft),
        ready_to_release: !blocking,
        findings_list: findings.map(findingForAgent),
        next_step: blocking
          ? 'Fix the blocking findings in the files, then call skyv_update_draft (or skyv_prepare_release again).'
          : ctx.level === 'release'
            ? NEXT_STEP_LEVEL3
            : NEXT_STEP_USER
      })
    }
  })

  api.register('skyv_update_draft', {
    level: 'prepare',
    needsSite: true,
    handler: async (params, ctx) => {
      const site = ctx.site!
      const store = draftStoreFor(s, site.id)
      const draft = await store.get(String(params.draft_id ?? ''))
      if (!draft || draft.status !== 'open') throw new UserError('Fant ikke noe åpent utkast med den id-en.', 'Bruk skyv_get_status for å se åpne utkast.')
      const cs = await s.workspaces.scan(site.id)
      const files = Array.isArray(params.files) && params.files.length > 0 ? params.files : draft.files.filter((f) => !f.neededBy).map((f) => f.path)
      const { changes, neededBy } = selectChanges(cs, files)
      const { findings } = await s.checks.run(site.id, changes.map(changeKey))
      const updated = await store.update(draft.id, {
        files: toDraftFiles(changes, neededBy),
        findings: summarize(findings),
        note: typeof params.note === 'string' && params.note.trim() ? params.note.trim().slice(0, 2000) : draft.note
      })
      events.draftsChanged?.(site.id, updated)
      return limitReply({ ...draftForAgent(updated), ready_to_release: !findings.some((f) => f.severity === 'block'), findings_list: findings.map(findingForAgent) })
    }
  })

  api.register('skyv_discard_draft', {
    level: 'prepare',
    needsSite: true,
    handler: async (params, ctx) => {
      const store = draftStoreFor(s, ctx.site!.id)
      const draft = await store.get(String(params.draft_id ?? ''))
      if (!draft || draft.status !== 'open') throw new UserError('Fant ikke noe åpent utkast med den id-en.')
      await store.update(draft.id, { status: 'discarded' })
      events.draftsChanged?.(ctx.site!.id)
      return { draft_id: draft.id, status: 'discarded' }
    }
  })

  api.register('skyv_set_release_note', {
    level: 'prepare',
    needsSite: true,
    handler: async (params, ctx) => {
      const note = typeof params.note === 'string' ? params.note : ''
      if (!note.trim()) throw new UserError('Notatet kan ikke være tomt.')
      const r = await s.releases.setNote(ctx.site!.id, String(params.release_id ?? ''), note, ctx.client.name)
      return { release_id: r.id, note: r.note, written_by_ai: true }
    }
  })

  api.register('skyv_request_undo', {
    level: 'prepare',
    needsSite: true,
    handler: async (params, ctx) => {
      const site = ctx.site!
      const releaseId = String(params.release_id ?? '')
      const r = (await s.releases.list(site.id)).find((x) => x.id === releaseId)
      if (!r) throw new UserError(`Fant ingen utgivelse med id "${releaseId}".`)
      if (!releaseSummary(r).can_be_undone) throw new UserError('Denne utgivelsen kan ikke angres (den er allerede angret, eller sikkerhetskopien er fjernet).')
      const reason = typeof params.reason === 'string' ? params.reason.trim().slice(0, 1000) : ''
      if (!reason) throw new UserError('Skriv en kort begrunnelse i "reason".')
      const req = await draftStoreFor(s, site.id).requestUndo({ siteId: site.id, releaseId, reason, requestedBy: ctx.client.name })
      events.undoRequested?.(site.id, req)
      return {
        request_id: req.id,
        status: 'waiting_for_user',
        note: 'The user must approve the undo in Skyv. You cannot undo a release yourself.'
      }
    }
  })

  api.register('skyv_release_draft', {
    level: 'release',
    needsSite: true,
    handler: async (params, ctx) => {
      const site = ctx.site!
      const store = draftStoreFor(s, site.id)
      const draft = await store.get(String(params.draft_id ?? ''))
      if (!draft) throw new UserError('Fant ikke utkastet.', 'Bruk skyv_get_status for å se åpne utkast.')
      const v = await validateDraft(s, site, draft)
      if (!v.ok) {
        if (v.stale) await store.update(draft.id, { findings: summarize(v.findings) })
        return limitReply({
          released: false,
          problems: v.problems,
          findings_list: v.findings.map(findingForAgent),
          next_step: v.stale
            ? 'The files changed after the draft was prepared. Review them, fix any findings, and call skyv_update_draft before releasing again.'
            : 'Fix what you can in the files and update the draft. Otherwise the user must review and release in Skyv.'
        })
      }
      const release = await s.releases.publish(site.id, v.changes.map(changeKey), draft.note, false)
      await s.releases.setNote(site.id, release.id, draft.note, draft.createdBy).catch(() => undefined)
      await store.update(draft.id, { status: 'released', releaseId: release.id })
      events.draftsChanged?.(site.id)
      const check = release.check
      return limitReply({
        released: true,
        release: releaseSummary(release),
        failed_files: release.items.filter((i) => i.state === 'failed').map((i) => ({ path: i.path, error: i.error ?? null })),
        health_check: check
          ? {
              ok: check.ok,
              skipped: check.skipped ?? null,
              auto_undone: check.autoUndone ?? false,
              failures: healthFailuresForAgent(check, site.url)
            }
          : null,
        next_step: check ? healthNextStep(check) : 'Done.'
      })
    }
  })
}

export { draftForAgent }

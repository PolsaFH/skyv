import type { SiteService } from '../sites/siteService'
import type { Workspaces } from '../services/workspaces'
import type { ReleaseService } from '../services/releases'
import type { ChecksService } from '../services/checks'
import type { ServerCheckService } from '../services/serverCheck'
import type { Logs } from '../services/logs'
import { changeKey, selectedByDefault, type Change } from '../manifest/changes'
import { AgentApi } from './api'
import type { AgentStore } from './store'
import { LEVEL_LABEL } from './store'
import { DraftStore } from './drafts'

/** The app's services, shared with the user interface. */
export interface AgentServices {
  sites: SiteService
  workspaces: Workspaces
  releases: ReleaseService
  checks: ChecksService
  serverCheck: ServerCheckService
  logs: Logs
  store: AgentStore
}

/** The selection the user would get by default: everything except deletions, plus needed files. */
export function defaultSelection(cs: { changes: Change[] }): Change[] {
  return cs.changes.filter(selectedByDefault)
}

/** Register the read-only methods (level "Bare se"). */
export function registerReadMethods(api: AgentApi, s: AgentServices): void {
  api.register('skyv_list_sites', {
    level: 'none',
    needsSite: false,
    handler: async () => {
      const settings = await s.store.get()
      // Fresh numbers: scan each site first (fast thanks to the hash cache).
      for (const site of await s.sites.store.list()) {
        if (site.localPath) await s.workspaces.scan(site.id).catch(() => undefined)
      }
      const list = await s.sites.list()
      return {
        sites: list.map((site) => ({
          id: site.id,
          name: site.name,
          url: site.url || null,
          local_folder: site.localPath,
          permission: LEVEL_LABEL[s.store.levelFor(settings, site.id)],
          permission_level: s.store.levelFor(settings, site.id),
          pending_changes: site.pendingCount,
          server_deviations: site.deviationCount,
          ready: Boolean(site.host && site.username && site.hasPassword)
        }))
      }
    }
  })

  api.register('skyv_get_status', {
    level: 'read',
    needsSite: true,
    handler: async (_params, ctx) => {
      const site = ctx.site!
      const cs = await s.workspaces.scan(site.id)
      const count = (k: string) => cs.changes.filter((c) => c.kind === k).length
      const selection = defaultSelection(cs)
      const { findings } = selection.length > 0 ? await s.checks.run(site.id, selection.map(changeKey)) : { findings: [] }
      const sev = (x: string) => findings.filter((f) => f.severity === x).length
      const server = await s.serverCheck.last(site.id)
      const releases = await s.releases.list(site.id)
      const last = releases[0]
      return {
        site: { id: site.id, name: site.name, url: site.url || null, permission: LEVEL_LABEL[ctx.level!], permission_level: ctx.level },
        changes: {
          total: cs.changes.length,
          added: count('added'),
          modified: count('modified'),
          deleted: count('deleted'),
          renamed: count('renamed'),
          needs_starting_point: cs.needsStartingPoint || cs.needsCompare,
          last_released_at: cs.lastPublishedAt ?? null
        },
        findings_for_default_selection: { blocking: sev('block'), warnings: sev('warn'), tips: sev('info') },
        server_deviations: server
          ? {
              checked_at: server.checkedAt,
              exact_server_times: server.reliableTimes,
              missing_on_server: server.deviations.filter((d) => d.kind === 'missing').length,
              changed_on_server: server.deviations.filter((d) => d.kind === 'changed').length,
              only_on_server: server.deviations.filter((d) => d.kind === 'server-only').length
            }
          : null,
        drafts: (await new DraftStore(s.sites.store.siteDir(site.id)).open()).map((d) => ({
          draft_id: d.id,
          created_at: d.createdAt,
          created_by: d.createdBy,
          files: d.files.length,
          note: d.note,
          findings: d.findings
        })),
        undo_requests_waiting_for_user: (await new DraftStore(s.sites.store.siteDir(site.id)).openUndoRequests()).length,
        last_release: last
          ? {
              id: last.id,
              at: last.startedAt,
              status: last.status,
              files: last.items.length,
              note: last.note ?? null,
              health_check: last.check ? (last.check.skipped ? 'skipped' : last.check.ok ? 'ok' : 'failed') : null
            }
          : null
      }
    }
  })
}

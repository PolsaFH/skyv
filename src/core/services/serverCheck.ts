import type { SiteService } from '../sites/siteService'
import type { Workspaces } from './workspaces'
import type { ReleaseService } from './releases'
import type { Logs } from './logs'
import { runServerCheck, ServerCheckStore, type ServerCheckResult } from '../serverCheck/serverCheck'
import { resolveDeviation, type DeviationAction } from '../serverCheck/resolve'
import { UserError } from '../errors'
import type { Release } from '../release/types'

const BACKGROUND_EVERY_MS = 15 * 60 * 1000
const ACTION_LABEL: Record<DeviationAction, string> = {
  reupload: 'Last opp på nytt',
  'delete-local': 'Slett den på Macen også',
  'let-go': 'La den være borte',
  'fetch-server': 'Hent serverens versjon til Macen',
  'overwrite-mine': 'Overskriv med min versjon',
  'fetch-to-mac': 'Hent til Macen',
  dismiss: 'La være'
}

export interface ResolveOutcome {
  message: string
  /** Set when the choice led to a release ("Last opp på nytt"). */
  release?: Release
  result?: ServerCheckResult
}

/** Server checks ("Sjekk serveren"): one at a time per site, results cached for counts. */
export class ServerCheckService {
  private cache = new Map<string, ServerCheckResult | undefined>()
  private running = new Map<string, Promise<ServerCheckResult>>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly sites: SiteService,
    private readonly workspaces: Workspaces,
    private readonly releases: ReleaseService,
    private readonly logs: Logs,
    private readonly onUpdated: (siteId: string, result: ServerCheckResult | undefined) => void,
    /** Move a local file to the Trash (shell.trashItem in the app). */
    private readonly trash: (absPath: string) => Promise<void>
  ) {}

  store(siteId: string): ServerCheckStore {
    return new ServerCheckStore(this.sites.store.siteDir(siteId))
  }

  /** Number of unhandled deviations from the last check (0 if never checked). */
  deviationCount(siteId: string): number {
    return this.cache.get(siteId)?.deviations.length ?? 0
  }

  async loadAll(): Promise<void> {
    for (const s of await this.sites.store.list()) this.cache.set(s.id, await this.store(s.id).last().catch(() => undefined))
  }

  async last(siteId: string): Promise<ServerCheckResult | undefined> {
    if (!this.cache.has(siteId)) this.cache.set(siteId, await this.store(siteId).last())
    return this.cache.get(siteId)
  }

  private update(siteId: string, result: ServerCheckResult | undefined): void {
    this.cache.set(siteId, result)
    this.onUpdated(siteId, result)
  }

  /** Run a check now; concurrent requests share one run. Skipped while a release runs. */
  run(siteId: string): Promise<ServerCheckResult> {
    const existing = this.running.get(siteId)
    if (existing) return existing
    const job = (async () => {
      if (this.releases.isBusy(siteId)) throw new UserError('Skyv gir ut endringer akkurat nå.', 'Sjekk serveren når utgivelsen er ferdig.')
      const site = await this.sites.require(siteId)
      const ws = await this.workspaces.get(siteId)
      if (!ws.lastChangeSet) await this.workspaces.scan(siteId)
      const { client, info } = await this.workspaces.connectWithInfo(site)
      try {
        const result = await runServerCheck(ws, site.remoteRoot, client, info, this.store(siteId))
        this.update(siteId, result)
        const n = result.deviations.length
        await this.logs
          .for(siteId)
          .add('server-check', n === 0 ? 'Serveren ble sjekket: alt stemmer.' : `Serveren ble sjekket: ${n} ${n === 1 ? 'avvik' : 'avvik'}.`, result.deviations.map((d) => `${d.kind}: ${d.path}`))
          .catch(() => undefined)
        return result
      } finally {
        await client.close()
      }
    })().finally(() => this.running.delete(siteId))
    this.running.set(siteId, job)
    return job
  }

  /** Carry out the user's choice for one deviation. */
  async resolve(siteId: string, path: string, action: DeviationAction): Promise<ResolveOutcome> {
    if (this.releases.isBusy(siteId)) throw new UserError('Skyv gir ut endringer akkurat nå.', 'Prøv igjen når utgivelsen er ferdig.')
    const site = await this.sites.require(siteId)
    const ws = await this.workspaces.get(siteId)
    const store = this.store(siteId)
    const last = await store.last()
    const deviation = last?.deviations.find((d) => d.path === path)
    if (!deviation) throw new UserError('Fant ikke dette avviket lenger.', 'Sjekk serveren på nytt.')
    const r = await resolveDeviation(
      {
        workspace: ws,
        remoteRoot: site.remoteRoot,
        store,
        connect: () => this.workspaces.connect(site),
        trash: this.trash
      },
      deviation,
      action
    )
    await this.logs.for(siteId).add('server-deviation', `${ACTION_LABEL[action]}: ${r.message}`).catch(() => undefined)
    this.update(siteId, await store.last())
    await this.workspaces.scan(siteId).catch(() => undefined)

    let release: Release | undefined
    if (r.release) {
      // "Last opp på nytt": a normal release of just these files, with the usual checks and stops.
      release = await this.releases.publish(siteId, r.release.map((p) => `added::${p}`), `Lastet opp på nytt fordi filen manglet på serveren: ${r.release.join(', ')}`)
    }
    return { message: r.message, release, result: this.cache.get(siteId) }
  }

  /** Every minute: run a background check for sites that want it and were last checked over 15 minutes ago. */
  startBackground(): void {
    this.timer ??= setInterval(() => void this.backgroundTick(), 60 * 1000)
    this.timer.unref?.()
  }

  stopBackground(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async backgroundTick(): Promise<void> {
    for (const site of await this.sites.store.list()) {
      if (!site.settings.serverCheckInBackground || !site.host) continue
      const last = await this.last(site.id)
      if (last && Date.now() - Date.parse(last.checkedAt) < BACKGROUND_EVERY_MS) continue
      if (this.releases.isBusy(site.id) || !(await this.sites.getPassword(site.id).catch(() => undefined))) continue
      await this.run(site.id).catch(() => undefined)
    }
  }
}

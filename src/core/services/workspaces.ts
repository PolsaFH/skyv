import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { SiteWorkspace, inProcessScan, type ChangeSet, type ScanFn } from '../workspace'
import type { SiteService } from '../sites/siteService'
import type { Site } from '../types'
import type { ScanProgress } from '../scan/scanner'
import { createRemote } from '../remote'
import type { RemoteClient, ConnectInfo } from '../remote/types'
import { UserError } from '../errors'
import { SessionStore } from '../watch/sessions'

/** One SiteWorkspace per site, plus helpers that need the app (passwords, connections). */
export class Workspaces {
  private map = new Map<string, SiteWorkspace>()
  private running = new Map<string, Promise<ChangeSet>>()

  /** Called after every scan (from the window, the menu bar or the background watcher). */
  onScanned: (siteId: string, cs: ChangeSet) => void = () => undefined

  constructor(
    private readonly sites: SiteService,
    /** How folders are scanned: in a worker thread in the app, in-process in tests. */
    private readonly scanFn: ScanFn = inProcessScan
  ) {}

  async get(id: string): Promise<SiteWorkspace> {
    const site = await this.sites.require(id)
    let ws = this.map.get(id)
    if (!ws) {
      ws = new SiteWorkspace(site, this.sites.store.siteDir(id), this.scanFn)
      this.map.set(id, ws)
    } else {
      ws.setSite(site)
    }
    return ws
  }

  forget(id: string): void {
    this.map.delete(id)
  }

  pendingCount(id: string): number {
    return this.map.get(id)?.lastChangeSet?.changes.length ?? 0
  }

  /** Scan a site; concurrent requests for the same site share one scan. */
  scan(id: string, onProgress?: (p: ScanProgress) => void): Promise<ChangeSet> {
    const existing = this.running.get(id)
    if (existing) return existing
    const job = (async () => {
      const ws = await this.get(id)
      const res = await ws.scan(onProgress)
      // Which session each changed file came from.
      const byPath = await new SessionStore(this.sites.store.siteDir(id)).byPath()
      const sessions: NonNullable<ChangeSet['sessions']> = {}
      for (const c of res.changes) {
        const s = byPath.get(c.path) ?? (c.from ? byPath.get(c.from) : undefined)
        if (s) sessions[c.path] = { id: s.id, endedAt: s.endedAt }
      }
      res.sessions = sessions
      // A local starting point ("start here" / "upload everything") is applied during the first scan.
      const site = await this.sites.require(id)
      if (site.startingPoint && !site.startingPoint.applied && site.startingPoint.choice !== 'compare' && !res.needsStartingPoint) {
        await this.sites.store.update(id, { startingPoint: { ...site.startingPoint, applied: true } })
      }
      this.onScanned(id, res)
      return res
    })().finally(() => this.running.delete(id))
    this.running.set(id, job)
    return job
  }

  /** Connect to a site's server with the stored password. Caller must close the client. */
  async connect(site: Site): Promise<RemoteClient> {
    return (await this.connectWithInfo(site)).client
  }

  /** Like connect, but also returns what the server told us (e.g. whether it reports exact times). */
  async connectWithInfo(site: Site): Promise<{ client: RemoteClient; info: ConnectInfo }> {
    const password = await this.sites.getPassword(site.id)
    if (!password) throw new UserError('Passordet til webhotellet mangler.', 'Legg det inn i innstillingene for nettsiden.')
    const client = createRemote({
      protocol: site.protocol,
      host: site.host,
      port: site.port,
      username: site.username,
      password,
      acceptSelfSigned: site.settings.acceptSelfSigned,
      sftpHostKey: site.sftpHostKey
    })
    const info = await client.connect()
    return { client, info }
  }

  /** Download one remote file into memory (via a temp file). */
  async fetchRemoteFile(client: RemoteClient, remotePath: string): Promise<Buffer | null> {
    const dest = join(tmpdir(), `skyv-${randomBytes(6).toString('hex')}.skyvtmp`)
    try {
      await client.download(remotePath, dest)
      return await fs.readFile(dest)
    } catch {
      return null
    } finally {
      await fs.rm(dest, { force: true })
    }
  }
}

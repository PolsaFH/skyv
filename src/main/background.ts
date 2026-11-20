import { Notification } from 'electron'
import { SiteWatcher } from '../core/watch/siteWatcher'
import { SessionTracker, SessionStore, type WorkSession } from '../core/watch/sessions'
import { createIgnoreMatcher } from '../core/scan/ignoreRules'
import type { SiteService } from '../core/sites/siteService'
import type { Site } from '../core/types'
import type { Workspaces } from '../core/services/workspaces'
import type { AppSettingsStore } from '../core/appSettings'

interface Watched {
  site: Site
  watcher: SiteWatcher
  tracker: SessionTracker
  /** Fingerprint of the settings the watcher was started with. */
  signature: string
}

/**
 * Watches every site folder in the background. When changes stop for a while (the site's
 * "quiet seconds"), the burst is recorded as a session, the site is rescanned and a
 * notification asks whether it is ready to be given out.
 */
export class BackgroundService {
  private watched = new Map<string, Watched>()

  constructor(
    private readonly sites: SiteService,
    private readonly workspaces: Workspaces,
    private readonly settings: AppSettingsStore,
    private readonly ui: { isFocusedOn: (siteId: string) => boolean; openSite: (siteId: string) => void }
  ) {}

  sessionStore(siteId: string): SessionStore {
    return new SessionStore(this.sites.store.siteDir(siteId))
  }

  /** Start, restart or stop watchers so they match the current list of sites. */
  async refresh(): Promise<void> {
    const sites = await this.sites.store.list()
    const ids = new Set(sites.map((s) => s.id))
    for (const [id, w] of this.watched) {
      if (!ids.has(id)) await this.stopOne(id, w)
    }
    for (const site of sites) {
      if (!site.localPath) continue
      const ws = await this.workspaces.get(site.id)
      const ignore = await ws.ignoreOptions()
      const signature = JSON.stringify([site.localPath, site.settings.quietSeconds, ignore])
      const cur = this.watched.get(site.id)
      if (cur && cur.signature === signature) {
        cur.site = site
        continue
      }
      if (cur) await this.stopOne(site.id, cur)
      const tracker = new SessionTracker({ quietMs: site.settings.quietSeconds * 1000, onSession: (s) => void this.onSession(site.id, s) })
      const watcher = new SiteWatcher({ root: site.localPath, ignore: createIgnoreMatcher(ignore), onPath: (p) => tracker.touch(p) })
      try {
        await watcher.start()
        this.watched.set(site.id, { site, watcher, tracker, signature })
      } catch {
        // Folder missing or unreadable: the change list explains this when the site is opened.
      }
    }
  }

  private async stopOne(id: string, w: Watched): Promise<void> {
    w.tracker.stop()
    await w.watcher.stop().catch(() => undefined)
    this.watched.delete(id)
  }

  async stopAll(): Promise<void> {
    for (const [id, w] of this.watched) await this.stopOne(id, w)
  }

  private async onSession(siteId: string, session: WorkSession): Promise<void> {
    const site = await this.sites.store.get(siteId)
    if (!site) return
    await this.sessionStore(siteId).add(session)
    const cs = await this.workspaces.scan(siteId).catch(() => null)
    if (!cs) return
    const touched = new Set(session.paths)
    const count = cs.changes.filter((c) => touched.has(c.path) || (c.from && touched.has(c.from))).length
    if (count === 0) return
    const app = await this.settings.get()
    if (!app.notifications || this.ui.isFocusedOn(siteId) || !Notification.isSupported()) return
    const n = new Notification({
      title: site.name,
      body: `${count === 1 ? '1 fil' : `${count} filer`} endret i ${site.name}. Klar til å gis ut?`,
      actions: [{ type: 'button', text: 'Se gjennom' }],
      silent: false
    })
    n.on('click', () => this.ui.openSite(siteId))
    n.on('action', () => this.ui.openSite(siteId))
    n.show()
  }
}

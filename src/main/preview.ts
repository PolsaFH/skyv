import { BrowserWindow, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { SiteService } from '../core/sites/siteService'
import type { Workspaces } from '../core/services/workspaces'
import { startStaticServer, PHP_ROUTER, type LocalServer } from '../core/preview/staticServer'
import { startPhpServer } from '../core/php/php'
import { createIgnoreMatcher } from '../core/scan/ignoreRules'
import { pagesToCheck, urlFor, type PageToCheck } from '../core/verify/postCheck'
import { extensionOf, isTextPath } from '../core/files/fileTypes'
import { UserError } from '../core/errors'
import { getPhp } from '../core/services/phpService'

export interface PreviewInfo {
  /** How the local version is shown: own static server, PHP's server, or not at all. */
  local: 'static' | 'php' | 'unavailable'
  localReason?: string
  live: boolean
  liveReason?: string
}

export interface Capture {
  dataUrl: string
  height: number
}

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IDLE_MS = 10 * 60 * 1000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Local preview servers per site, and screenshots of pages for "før og etter". */
export class PreviewService {
  private servers = new Map<string, { server: LocalServer; kind: 'static' | 'php'; timer: ReturnType<typeof setTimeout> }>()

  constructor(
    private readonly sites: SiteService,
    private readonly workspaces: Workspaces,
    private readonly dataDir: string
  ) {}

  private async usesPhp(siteId: string): Promise<boolean> {
    const ws = await this.workspaces.get(siteId)
    if (ws.scannedPaths.length === 0) await this.workspaces.scan(siteId)
    return ws.scannedPaths.some((p) => ['php', 'phtml'].includes(extensionOf(p)))
  }

  async info(siteId: string): Promise<PreviewInfo> {
    const site = await this.sites.require(siteId)
    const live = Boolean(site.url)
    const liveReason = live ? undefined : 'Nettadressen mangler, så den ekte siden kan ikke vises. Legg den inn i innstillingene.'
    if (await this.usesPhp(siteId)) {
      if (!(await getPhp())) {
        return { local: 'unavailable', localReason: 'Nettsiden bruker PHP, men PHP er ikke installert på Macen. Derfor vises bare den ekte siden.', live, liveReason }
      }
      return { local: 'php', live, liveReason }
    }
    return { local: 'static', live, liveReason }
  }

  private async server(siteId: string): Promise<string> {
    const existing = this.servers.get(siteId)
    if (existing) {
      clearTimeout(existing.timer)
      existing.timer = setTimeout(() => void this.stop(siteId), IDLE_MS)
      return existing.server.url
    }
    const site = await this.sites.require(siteId)
    const info = await this.info(siteId)
    if (info.local === 'unavailable') throw new UserError(info.localReason ?? 'Lokal forhåndsvisning er ikke tilgjengelig.')
    let server: LocalServer
    if (info.local === 'php') {
      const php = (await getPhp())!
      const router = join(this.dataDir, 'preview-router.php')
      await fs.writeFile(router, PHP_ROUTER)
      server = await startPhpServer(php.path, site.localPath, undefined, ['-d', 'display_errors=1'], router)
    } else {
      const ws = await this.workspaces.get(siteId)
      server = await startStaticServer(site.localPath, createIgnoreMatcher(await ws.ignoreOptions()))
    }
    this.servers.set(siteId, { server, kind: info.local, timer: setTimeout(() => void this.stop(siteId), IDLE_MS) })
    return server.url
  }

  async stop(siteId: string): Promise<void> {
    const s = this.servers.get(siteId)
    if (!s) return
    this.servers.delete(siteId)
    clearTimeout(s.timer)
    await s.server.stop().catch(() => undefined)
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.servers.keys()].map((id) => this.stop(id)))
  }

  /** Pages worth comparing: changed pages, and pages that use changed CSS, images or includes. */
  async pages(siteId: string): Promise<PageToCheck[]> {
    const ws = await this.workspaces.get(siteId)
    const cs = ws.lastChangeSet ?? (await this.workspaces.scan(siteId))
    const changed = cs.changes.filter((c) => c.kind !== 'deleted').map((c) => c.path)
    return pagesToCheck(changed, ws.scannedPaths.filter(isTextPath), (p) => ws.readText(p))
  }

  private async urlOf(siteId: string, path: string, which: 'live' | 'local'): Promise<string> {
    const ws = await this.workspaces.get(siteId)
    ws.localPath(path) // validates the path
    if (which === 'local') return urlFor(await this.server(siteId), path)
    const site = await this.sites.require(siteId)
    if (!site.url) throw new UserError('Nettadressen mangler.', 'Legg den inn i innstillingene for nettsiden.')
    const u = urlFor(site.url, path)
    return `${u}${u.includes('?') ? '&' : '?'}skyv=${Date.now().toString(36)}`
  }

  /** Screenshot of the whole page at the given width, taken in a hidden window. */
  async capture(siteId: string, path: string, which: 'live' | 'local', width: number): Promise<Capture> {
    const url = await this.urlOf(siteId, path, which)
    const w = Math.max(320, Math.min(1920, Math.round(width)))
    const win = new BrowserWindow({
      show: false,
      width: w,
      height: 900,
      enableLargerThanScreen: true,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'skyv-preview', backgroundThrottling: false }
    })
    try {
      win.webContents.setAudioMuted(true)
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      if (w < 600) win.webContents.setUserAgent(MOBILE_UA)
      const loaded = new Promise<void>((resolve, reject) => {
        win.webContents.once('did-finish-load', () => resolve())
        win.webContents.once('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
          if (isMainFrame) reject(new UserError('Siden kunne ikke lastes.', `${desc || 'Ukjent feil'} (${code}).`))
        })
      })
      void win.loadURL(url).catch(() => undefined)
      await Promise.race([loaded, sleep(20000).then(() => undefined)])
      await sleep(700) // fonts, images and scripts
      const height = Math.round(
        Math.min(
          6000,
          Number(await win.webContents.executeJavaScript('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, 400)').catch(() => 900))
        )
      )
      win.setContentSize(w, height)
      await sleep(300)
      const img = await win.webContents.capturePage()
      return { dataUrl: `data:image/jpeg;base64,${img.toJPEG(82).toString('base64')}`, height }
    } finally {
      win.destroy()
    }
  }

  async open(siteId: string, path: string, which: 'live' | 'local'): Promise<void> {
    await shell.openExternal(await this.urlOf(siteId, path, which))
  }
}

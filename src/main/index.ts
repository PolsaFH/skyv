import { app, BrowserWindow, ipcMain, shell, safeStorage } from 'electron'
import { workerScan } from './workerScan'
import { join } from 'node:path'
import { SiteStore } from '../core/sites/siteStore'
import { SecretStore } from '../core/secrets/secretStore'
import { SiteService } from '../core/sites/siteService'
import { registerIpc } from './ipc'
import { RemoteSessions } from '../core/remote'
import { Workspaces } from '../core/services/workspaces'
import { ReleaseService } from '../core/services/releases'
import { ChecksService } from '../core/services/checks'
import { BackgroundService } from './background'
import { PreviewService } from './preview'
import { SummaryService } from '../core/services/summary'
import { Logs } from '../core/services/logs'
import { ServerCheckService } from '../core/services/serverCheck'
import { startAgent } from './agent'
import { SkyvTray } from './tray'
import { buildMenu } from './menu'
import { AppSettingsStore, type AppSettings } from '../core/appSettings'
import { IPC } from '../core/api'
import { toSerializedError } from '../core/errors'

const isDev = Boolean(process.env['ELECTRON_RENDERER_URL'])
const preload = join(__dirname, '../preload/index.js')

let mainWindow: BrowserWindow | null = null
let quitting = false
let tray: SkyvTray | null = null
let selectedSiteId: string | null = null

function loadRenderer(win: BrowserWindow, hash = ''): void {
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${hash ? `#${hash}` : ''}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

function createWindow(settings: () => Promise<AppSettings>): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: 'Skyv',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  win.once('ready-to-show', () => win.show())
  // Never navigate the app window away; open external links in the browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })
  // Closing the window keeps Skyv running in the menu bar, unless the user turned that off.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    void settings().then((s) => {
      if (s.keepRunningInBackground) win.hide()
      else {
        quitting = true
        app.quit()
      }
    })
  })
  win.on('closed', () => (mainWindow = null))
  loadRenderer(win)
  return win
}

app.setName('Skyv')

// Only one Skyv at a time.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(async () => {
    const dataDir = app.getPath('userData')
    const appSettings = new AppSettingsStore(dataDir)
    const secrets = new SecretStore(join(dataDir, 'secrets'), {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (data) => safeStorage.decryptString(data)
    })
    const sites = new SiteService(new SiteStore(dataDir), secrets)
    const remoteSessions = new RemoteSessions()
    const workspaces = new Workspaces(sites, workerScan)
    sites.pendingCount = (id) => workspaces.pendingCount(id)
    const checks = new ChecksService(sites, workspaces)

    const windows = () => [mainWindow, tray?.window].filter((w): w is BrowserWindow => Boolean(w && !w.isDestroyed()))
    const broadcast = (channel: string, payload?: unknown) => windows().forEach((w) => w.webContents.send(channel, payload))

    const showMain = () => {
      mainWindow ??= createWindow(() => appSettings.get())
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      tray?.hide()
      return mainWindow
    }
    const openSite = (siteId: string) => {
      const win = showMain()
      const send = () => win.webContents.send(IPC.evSelectSite, siteId)
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
      else send()
    }
    const openAppSettings = () => {
      const win = showMain()
      const send = () => win.webContents.send(IPC.evOpenAppSettings)
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
      else send()
    }

    const logs = new Logs(sites)
    const releases = new ReleaseService(sites, workspaces, checks, (progress) => broadcast(IPC.progress, { siteId: progress.siteId, kind: 'release', progress }), logs)
    const summary = new SummaryService(sites, workspaces, checks, secrets, appSettings)
    const serverCheck = new ServerCheckService(
      sites,
      workspaces,
      releases,
      logs,
      (siteId, result) => broadcast(IPC.evServerCheckUpdated, { siteId, result: result ?? null }),
      (abs) => shell.trashItem(abs)
    )
    sites.deviationCount = (id) => serverCheck.deviationCount(id)
    releases.deviationPaths = async (id) => ((await serverCheck.last(id))?.deviations ?? []).map((d) => d.path)
    await serverCheck.loadAll()
    const background = new BackgroundService(sites, workspaces, appSettings, {
      isFocusedOn: (siteId) => Boolean(mainWindow?.isFocused() && selectedSiteId === siteId),
      openSite
    })

    const updateTrayCount = async () => {
      if (!tray) return
      const s = await appSettings.get()
      const list = await sites.store.list()
      const n =
        s.trayCount === 'selected' && selectedSiteId
          ? workspaces.pendingCount(selectedSiteId)
          : list.reduce((sum, site) => sum + workspaces.pendingCount(site.id), 0)
      tray.setCount(n)
    }
    workspaces.onScanned = (siteId, changeSet) => {
      broadcast(IPC.evChangesUpdated, { siteId, changeSet })
      void updateTrayCount()
    }

    const applyAppSettings = async (s: AppSettings) => {
      if (process.platform === 'darwin') {
        if (s.showDockIcon) await app.dock?.show()
        else app.dock?.hide()
      }
      // Registering a login item only makes sense for the installed app.
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.openAtLogin })
      await updateTrayCount()
    }

    const preview = new PreviewService(sites, workspaces, dataDir)
    registerIpc({
      serverCheck,
      summary,
      logs,
      preview,
      sites,
      remoteSessions,
      workspaces,
      releases,
      checks,
      getWindow: () => mainWindow,
      onSitesChanged: () => void background.refresh()
    })
    ipcMain.handle(IPC.appGetSettings, async () => ({ ok: true, value: await appSettings.get() }))
    ipcMain.handle(IPC.appSetSettings, async (_e, patch: Partial<AppSettings>) => {
      const s = await appSettings.update(patch && typeof patch === 'object' ? patch : {})
      await applyAppSettings(s)
      return { ok: true, value: s }
    })
    ipcMain.on(IPC.appSelectedSite, (_e, siteId: unknown) => {
      selectedSiteId = typeof siteId === 'string' ? siteId : null
      void updateTrayCount()
    })
    ipcMain.handle(IPC.appOpenMain, async (_e, siteId?: unknown) => {
      if (typeof siteId === 'string') openSite(siteId)
      else showMain()
      return { ok: true, value: undefined }
    })
    ipcMain.handle(IPC.appQuickRelease, async (_e, siteId: unknown, accept: unknown) => {
      try {
        if (typeof siteId !== 'string') throw new Error('Invalid id')
        return { ok: true, value: await releases.quickRelease(siteId, accept === true) }
      } catch (err) {
        return { ok: false, error: toSerializedError(err) }
      }
    })

    const agent = await startAgent({
      dataDir,
      services: { sites, workspaces, releases, checks, serverCheck },
      secrets,
      logs,
      showMain,
      broadcast,
      preview,
      openSite
    })

    buildMenu(openAppSettings, isDev)
    // The installed app gets its icon from the bundle; in development, set it here.
    if (!app.isPackaged && process.platform === 'darwin') app.dock?.setIcon(join(app.getAppPath(), 'resources', 'icon.png'))
    tray = new SkyvTray({ preload, loadRenderer, openMain: showMain, openAppSettings })

    const settings = await appSettings.get()
    await applyAppSettings(settings)
    const startedHidden = app.getLoginItemSettings().wasOpenedAtLogin && settings.keepRunningInBackground
    if (!startedHidden) mainWindow = createWindow(() => appSettings.get())

    // Watch all sites in the background and get counts for the menu bar.
    await background.refresh()
    serverCheck.startBackground()
    for (const site of await sites.store.list()) await workspaces.scan(site.id).catch(() => undefined)

    app.on('second-instance', () => showMain())
    app.on('activate', () => showMain())
    app.on('before-quit', () => {
      quitting = true
      void remoteSessions.closeAll()
      void background.stopAll()
      void preview.stopAll()
      serverCheck.stopBackground()
      void agent.server?.close()
    })
  })
}

app.on('window-all-closed', () => {
  // On macOS Skyv lives on in the menu bar; the close handler decides whether to quit.
  if (process.platform !== 'darwin') app.quit()
})

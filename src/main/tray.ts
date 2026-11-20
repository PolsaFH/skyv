import { app, BrowserWindow, Menu, Tray, nativeImage, screen } from 'electron'
import { join } from 'node:path'

export interface TrayDeps {
  preload: string
  loadRenderer: (win: BrowserWindow, hash: string) => void
  openMain: () => void
  openAppSettings: () => void
}

/** Menu bar icon with the number of changes waiting, and a small popover window. */
export class SkyvTray {
  private tray: Tray
  private popover: BrowserWindow | null = null

  constructor(private readonly deps: TrayDeps) {
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'trayTemplate.png'))
    icon.setTemplateImage(true)
    this.tray = new Tray(icon)
    this.tray.setToolTip('Skyv')
    this.tray.on('click', () => this.toggle())
    this.tray.on('right-click', () =>
      this.tray.popUpContextMenu(
        Menu.buildFromTemplate([
          { label: 'Åpne Skyv', click: () => this.deps.openMain() },
          { label: 'Innstillinger …', click: () => this.deps.openAppSettings() },
          { type: 'separator' },
          { label: 'Avslutt Skyv', click: () => app.quit() }
        ])
      )
    )
  }

  /** Show the number of files not yet given out (empty when there are none). */
  setCount(n: number): void {
    this.tray.setTitle(n > 0 ? ` ${n}` : '', { fontType: 'monospacedDigit' })
    this.tray.setToolTip(n > 0 ? `Skyv: ${n} ${n === 1 ? 'endring venter' : 'endringer venter'}` : 'Skyv: alt er gitt ut')
  }

  get window(): BrowserWindow | null {
    return this.popover
  }

  private create(): BrowserWindow {
    const win = new BrowserWindow({
      width: 340,
      height: 420,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      vibrancy: 'popover',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
      webPreferences: { preload: this.deps.preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    win.on('blur', () => win.hide())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    this.deps.loadRenderer(win, 'tray')
    win.on('closed', () => (this.popover = null))
    return win
  }

  toggle(): void {
    this.popover ??= this.create()
    const win = this.popover
    if (win.isVisible()) {
      win.hide()
      return
    }
    const b = this.tray.getBounds()
    const { width } = win.getBounds()
    const display = screen.getDisplayNearestPoint({ x: b.x, y: b.y })
    const x = Math.round(Math.min(Math.max(b.x + b.width / 2 - width / 2, display.workArea.x + 8), display.workArea.x + display.workArea.width - width - 8))
    const y = Math.round(b.y + b.height + 4)
    win.setPosition(x, y, false)
    win.show()
    win.focus()
  }

  hide(): void {
    this.popover?.hide()
  }

  destroy(): void {
    this.popover?.destroy()
    this.tray.destroy()
  }
}

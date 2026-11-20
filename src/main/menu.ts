import { Menu } from 'electron'

/** Norwegian application menu. Edit commands are needed for copy/paste in text fields. */
export function buildMenu(openAppSettings: () => void, isDev: boolean): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Skyv',
      submenu: [
        { role: 'about', label: 'Om Skyv' },
        { type: 'separator' },
        { label: 'Innstillinger …', accelerator: 'CmdOrCtrl+,', click: openAppSettings },
        { type: 'separator' },
        { role: 'hide', label: 'Skjul Skyv' },
        { role: 'hideOthers', label: 'Skjul andre' },
        { role: 'unhide', label: 'Vis alle' },
        { type: 'separator' },
        { role: 'quit', label: 'Avslutt Skyv' }
      ]
    },
    {
      label: 'Rediger',
      submenu: [
        { role: 'undo', label: 'Angre skriving' },
        { role: 'redo', label: 'Gjør om' },
        { type: 'separator' },
        { role: 'cut', label: 'Klipp ut' },
        { role: 'copy', label: 'Kopier' },
        { role: 'paste', label: 'Lim inn' },
        { role: 'selectAll', label: 'Merk alt' }
      ]
    },
    {
      label: 'Vis',
      submenu: [
        ...(isDev ? ([{ role: 'reload', label: 'Last inn på nytt' }, { role: 'toggleDevTools', label: 'Utviklerverktøy' }, { type: 'separator' }] as Electron.MenuItemConstructorOptions[]) : []),
        { role: 'resetZoom', label: 'Vanlig størrelse' },
        { role: 'zoomIn', label: 'Større' },
        { role: 'zoomOut', label: 'Mindre' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Fullskjerm' }
      ]
    },
    { role: 'windowMenu', label: 'Vindu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

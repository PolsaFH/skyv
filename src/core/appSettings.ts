import { join } from 'node:path'
import { readJson, writeJsonAtomic } from './storage/atomicJson'

/** Settings for the whole app (not per site). */
export interface AppSettings {
  openAtLogin: boolean
  /** Keep running in the menu bar when the window is closed. */
  keepRunningInBackground: boolean
  showDockIcon: boolean
  /** Number next to the menu bar icon: all sites summed, or only the selected site. */
  trayCount: 'all' | 'selected'
  /** macOS notification when a session of changes is finished. */
  notifications: boolean
  /** "Skriv sammendrag med AI" (needs the user's own Anthropic API key). Off by default. */
  aiSummaries: boolean
  /** The user has seen exactly what is sent to the AI and agreed. */
  aiConsentGiven: boolean
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  openAtLogin: false,
  keepRunningInBackground: true,
  showDockIcon: true,
  trayCount: 'all',
  notifications: true,
  aiSummaries: false,
  aiConsentGiven: false
}

export class AppSettingsStore {
  private cache: AppSettings | null = null

  constructor(private readonly dataDir: string) {}

  private get file(): string {
    return join(this.dataDir, 'app-settings.json')
  }

  async get(): Promise<AppSettings> {
    this.cache ??= { ...DEFAULT_APP_SETTINGS, ...(await readJson<Partial<AppSettings>>(this.file, {})) }
    return { ...this.cache }
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const cur = await this.get()
    const next: AppSettings = {
      openAtLogin: patch.openAtLogin ?? cur.openAtLogin,
      keepRunningInBackground: patch.keepRunningInBackground ?? cur.keepRunningInBackground,
      showDockIcon: patch.showDockIcon ?? cur.showDockIcon,
      trayCount: patch.trayCount === 'selected' || patch.trayCount === 'all' ? patch.trayCount : cur.trayCount,
      notifications: patch.notifications ?? cur.notifications,
      aiSummaries: patch.aiSummaries ?? cur.aiSummaries,
      aiConsentGiven: patch.aiConsentGiven ?? cur.aiConsentGiven
    }
    // Without a Dock icon and without running in the background there would be no way back to the app.
    if (!next.showDockIcon) next.keepRunningInBackground = true
    await writeJsonAtomic(this.file, next)
    this.cache = next
    return { ...next }
  }
}

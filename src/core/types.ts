// Shared data model. Pure types, safe to import from main, preload, renderer and tests.

export type Protocol = 'ftp' | 'ftps' | 'sftp'

export interface SiteSettings {
  /** Number of simultaneous connections during upload. */
  concurrency: number
  /** Seconds of quiet before a batch of local changes is treated as a finished session. */
  quietSeconds: number
  /** How many releases keep their snapshot. */
  snapshotKeep: number
  /** Max total snapshot size in megabytes. */
  snapshotMaxMB: number
  /** Max total size of stored line differences in megabytes (kept longer than snapshots). */
  diffMaxMB: number
  /** FTPS only: accept self-signed certificates. */
  acceptSelfSigned: boolean
  /** Undo a release automatically if the post-upload check fails. */
  autoUndoOnFailedCheck: boolean
  /** Ignore *.map files (source maps). */
  ignoreSourceMaps: boolean
  /** Check the server for deviations every 15 minutes in the background. Off by default, to spare the web host. */
  serverCheckInBackground: boolean
}

export interface Site {
  id: string
  name: string
  localPath: string
  protocol: Protocol
  host: string
  port: number
  username: string
  /** Remote root folder, always starting with "/". */
  remoteRoot: string
  /** Public address, https://... (may be empty until set). */
  url: string
  /** Extra ignore rules (gitignore syntax), one per line. */
  ignoreRules: string
  settings: SiteSettings
  /** SFTP: remembered host key fingerprint, set on first successful connection. */
  sftpHostKey?: string
  /** What the user chose as starting point in the setup wizard. Applied once by the scanner. */
  startingPoint?: StartingPoint
  createdAt: string
  updatedAt: string
}

/** What the renderer gets: the site plus whether a password is stored. Never the password itself. */
export interface SiteView extends Site {
  hasPassword: boolean
  pendingCount: number
  /** Unhandled deviations found by the last server check. */
  deviationCount: number
}

export type StartingPointChoice = 'assume-synced' | 'compare' | 'upload-all'

export interface StartingPoint {
  choice: StartingPointChoice
  chosenAt: string
  /** True once the choice has been carried out (baseline recorded, compared or uploaded). */
  applied: boolean
}

export type SiteInput = Partial<Omit<Site, 'id' | 'createdAt' | 'updatedAt' | 'settings'>> & {
  settings?: Partial<SiteSettings>
}

export const DEFAULT_SETTINGS: SiteSettings = {
  concurrency: 3,
  quietSeconds: 8,
  snapshotKeep: 20,
  snapshotMaxMB: 500,
  diffMaxMB: 50,
  acceptSelfSigned: false,
  autoUndoOnFailedCheck: false,
  ignoreSourceMaps: true,
  serverCheckInBackground: false
}

export function defaultPort(protocol: Protocol): number {
  return protocol === 'sftp' ? 22 : 21
}

import type { Protocol } from '../types'

export type RemoteEntryType = 'file' | 'dir' | 'link' | 'other'

export interface RemoteEntry {
  name: string
  type: RemoteEntryType
  size: number
  /** Modification time in ms since epoch, if the server reports it reliably (MLSD / SFTP). */
  modifiedAt?: number
}

export interface ConnectionConfig {
  protocol: Protocol
  host: string
  port: number
  username: string
  password: string
  /** FTPS: accept self-signed / unverifiable certificates. */
  acceptSelfSigned?: boolean
  /** SFTP: expected host key fingerprint (sha256, base64). Mismatch fails the connection. */
  sftpHostKey?: string
  /** Connect / response timeout in ms. */
  timeoutMs?: number
}

export interface ConnectInfo {
  /** Folder the server put us in after login. */
  homeDir: string
  /** SFTP host key fingerprint seen during this connection. */
  sftpHostKey?: string
  /** Whether the server gives reliable modification times (MLSD for FTP; always for SFTP). */
  reliableTimes: boolean
}

/** Operations every protocol supports. All paths are absolute remote paths. */
export interface RemoteClient {
  connect(): Promise<ConnectInfo>
  list(path: string): Promise<RemoteEntry[]>
  /** Download a remote file to a local path (overwrites the local file). */
  download(remotePath: string, localPath: string): Promise<void>
  /** Upload a local file. `onBytes` reports bytes sent so far. */
  upload(localPath: string, remotePath: string, onBytes?: (bytes: number) => void): Promise<void>
  /** Rename/move, replacing `to` if it exists. */
  rename(from: string, to: string): Promise<void>
  /** Delete a single file. */
  remove(path: string): Promise<void>
  /** Create a folder and any missing parent folders. */
  ensureDir(path: string): Promise<void>
  /** Size and modification time of a file, or null if it does not exist. */
  stat(path: string): Promise<RemoteEntry | null>
  close(): Promise<void>
}

/** Anything that can list a folder; used by root detection so it can be tested without a server. */
export interface RemoteLister {
  list(path: string): Promise<RemoteEntry[]>
}

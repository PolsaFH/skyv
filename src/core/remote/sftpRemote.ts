import SftpClient from 'ssh2-sftp-client'
import { createHash } from 'node:crypto'
import type { ConnectInfo, ConnectionConfig, RemoteClient, RemoteEntry, RemoteEntryType } from './types'
import { toFriendlyRemoteError } from './friendlyErrors'
import { parentOf } from './paths'

export function hostKeyFingerprint(key: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
}

/** SFTP via ssh2-sftp-client. Remembers the server's host key and refuses a changed key. */
export class SftpRemote implements RemoteClient {
  readonly client = new SftpClient('skyv')
  private seenHostKey: string | undefined

  constructor(private readonly config: ConnectionConfig) {}

  private ctx(path?: string) {
    return { host: this.config.host, port: this.config.port, protocol: 'sftp', path }
  }

  async connect(): Promise<ConnectInfo> {
    const { host, port, username, password, sftpHostKey } = this.config
    let mismatch = false
    try {
      await this.client.connect({
        host,
        port,
        username,
        password,
        readyTimeout: this.config.timeoutMs ?? 20000,
        retries: 0,
        hostVerifier: (key: Buffer) => {
          this.seenHostKey = hostKeyFingerprint(key)
          if (sftpHostKey && sftpHostKey !== this.seenHostKey) {
            mismatch = true
            return false
          }
          return true
        }
      } as SftpClient.ConnectOptions)
      const homeDir = await this.client.realPath('.').catch(() => '/')
      return { homeDir, sftpHostKey: this.seenHostKey, reliableTimes: true }
    } catch (err) {
      await this.client.end().catch(() => undefined)
      if (mismatch) throw toFriendlyRemoteError(Object.assign(new Error('host key'), { code: 'HOST_KEY_MISMATCH' }), this.ctx())
      throw toFriendlyRemoteError(err, this.ctx())
    }
  }

  async list(path: string): Promise<RemoteEntry[]> {
    try {
      const items = await this.client.list(path)
      return items.map((f) => ({
        name: f.name,
        type: (f.type === 'd' ? 'dir' : f.type === '-' ? 'file' : f.type === 'l' ? 'link' : 'other') as RemoteEntryType,
        size: f.size,
        modifiedAt: f.modifyTime
      }))
    } catch (err) {
      throw toFriendlyRemoteError(err, this.ctx(path))
    }
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    try {
      await this.client.fastGet(remotePath, localPath)
    } catch (err) {
      throw toFriendlyRemoteError(err, this.ctx(remotePath))
    }
  }

  async upload(localPath: string, remotePath: string, onBytes?: (bytes: number) => void): Promise<void> {
    try {
      await this.client.fastPut(localPath, remotePath, onBytes ? { step: (total: number) => onBytes(total) } : undefined)
    } catch (err) {
      throw toFriendlyRemoteError(err, this.ctx(remotePath))
    }
  }

  async rename(from: string, to: string): Promise<void> {
    try {
      // posix-rename replaces the target atomically where the server supports it.
      await this.client.posixRename(from, to)
    } catch {
      try {
        if (await this.stat(to)) await this.client.delete(to)
        await this.client.rename(from, to)
      } catch (err) {
        throw toFriendlyRemoteError(err, this.ctx(to))
      }
    }
  }

  async remove(path: string): Promise<void> {
    try {
      await this.client.delete(path)
    } catch (err) {
      throw toFriendlyRemoteError(err, this.ctx(path))
    }
  }

  async ensureDir(path: string): Promise<void> {
    try {
      if (path !== '/' && !(await this.client.exists(path))) await this.client.mkdir(path, true)
    } catch (err) {
      throw toFriendlyRemoteError(err, this.ctx(path))
    }
  }

  async stat(path: string): Promise<RemoteEntry | null> {
    const name = path.slice(path.lastIndexOf('/') + 1)
    try {
      const entries = await this.list(parentOf(path))
      return entries.find((e) => e.name === name) ?? null
    } catch {
      return null
    }
  }

  async close(): Promise<void> {
    await this.client.end().catch(() => undefined)
  }
}

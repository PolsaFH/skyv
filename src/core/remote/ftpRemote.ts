import { Client, FileType, type FileInfo } from 'basic-ftp'
import type { ConnectInfo, ConnectionConfig, RemoteClient, RemoteEntry } from './types'
import { toFriendlyRemoteError } from './friendlyErrors'
import { withTimeout } from './timeout'
import { parentOf } from './paths'

function toEntry(f: FileInfo): RemoteEntry {
  const type = f.type === FileType.File ? 'file' : f.type === FileType.Directory ? 'dir' : f.type === FileType.SymbolicLink ? 'link' : 'other'
  return { name: f.name, type, size: f.size, modifiedAt: f.modifiedAt?.getTime() }
}

/** FTP and FTPS (explicit TLS) using basic-ftp. Passive mode and UTF-8 are basic-ftp defaults. */
export class FtpRemote implements RemoteClient {
  readonly client: Client
  private reliableTimes = false

  constructor(private readonly config: ConnectionConfig) {
    this.client = new Client(config.timeoutMs ?? 20000)
  }

  private ctx(path?: string) {
    return { host: this.config.host, port: this.config.port, protocol: this.config.protocol, path }
  }

  async connect(): Promise<ConnectInfo> {
    const { host, port, username, password, protocol, acceptSelfSigned } = this.config
    try {
      await withTimeout(
        this.client.access({
          host,
          port,
          user: username,
          password,
          secure: protocol === 'ftps',
          secureOptions: protocol === 'ftps' ? { rejectUnauthorized: !acceptSelfSigned, servername: host } : undefined
        }),
        this.config.timeoutMs ?? 20000,
        () => this.client.close()
      )
      const features = await this.client.features().catch(() => new Map<string, string>())
      this.reliableTimes = features.has('MLST')
      const homeDir = await this.client.pwd().catch(() => '/')
      return { homeDir: homeDir || '/', reliableTimes: this.reliableTimes }
    } catch (err) {
      this.client.close()
      throw toFriendlyRemoteError(err, this.ctx())
    }
  }

  async list(path: string): Promise<RemoteEntry[]> {
    try {
      const items = await this.client.list(path)
      return items.filter((f) => f.name !== '.' && f.name !== '..').map(toEntry)
    } catch (err) {
      throw toFriendlyRemoteError(err, this.ctx(path))
    }
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    try {
      await this.client.downloadTo(localPath, remotePath)
    } catch (err) {
      throw toFriendlyRemoteError(err, this.ctx(remotePath))
    }
  }

  async upload(localPath: string, remotePath: string, onBytes?: (bytes: number) => void): Promise<void> {
    try {
      if (onBytes) this.client.trackProgress((info) => onBytes(info.bytes))
      await this.client.uploadFrom(localPath, remotePath)
    } catch (err) {
      throw toFriendlyRemoteError(err, this.ctx(remotePath))
    } finally {
      if (onBytes) this.client.trackProgress()
    }
  }

  async rename(from: string, to: string): Promise<void> {
    try {
      await this.client.rename(from, to)
    } catch (first) {
      // Some servers refuse to rename onto an existing file. Remove the target and try once more.
      try {
        if (!(await this.stat(to))) throw first
        await this.client.remove(to)
        await this.client.rename(from, to)
      } catch (err) {
        throw toFriendlyRemoteError(err, this.ctx(to))
      }
    }
  }

  async remove(path: string): Promise<void> {
    try {
      await this.client.remove(path)
    } catch (err) {
      throw toFriendlyRemoteError(err, this.ctx(path))
    }
  }

  async ensureDir(path: string): Promise<void> {
    try {
      await this.client.ensureDir(path)
      await this.client.cd('/')
    } catch (err) {
      throw toFriendlyRemoteError(err, this.ctx(path))
    }
  }

  async stat(path: string): Promise<RemoteEntry | null> {
    const name = path.slice(path.lastIndexOf('/') + 1)
    let entries: FileInfo[]
    try {
      entries = await this.client.list(parentOf(path))
    } catch {
      return null
    }
    const hit = entries.find((e) => e.name === name)
    return hit ? toEntry(hit) : null
  }

  async close(): Promise<void> {
    this.client.close()
  }
}

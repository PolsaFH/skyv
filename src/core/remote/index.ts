import { randomUUID } from 'node:crypto'
import type { ConnectInfo, ConnectionConfig, RemoteClient } from './types'
import { FtpRemote } from './ftpRemote'
import { SftpRemote } from './sftpRemote'
import { UserError } from '../errors'

export function createRemote(config: ConnectionConfig): RemoteClient {
  if (!config.host) throw new UserError('Skriv inn adressen til serveren.', 'Du finner den hos webhotellet, ofte som ftp.dittdomene.no.')
  if (!config.username) throw new UserError('Skriv inn brukernavnet.')
  return config.protocol === 'sftp' ? new SftpRemote(config) : new FtpRemote(config)
}

interface Session {
  client: RemoteClient
  info: ConnectInfo
  timer: ReturnType<typeof setTimeout>
  /** Serialise operations: one FTP connection can only do one thing at a time. */
  tail: Promise<unknown>
}

/**
 * Short-lived connections used by the setup wizard (test, browse, detect root).
 * Sessions close themselves after a period of inactivity.
 */
export class RemoteSessions {
  private sessions = new Map<string, Session>()

  constructor(
    private readonly factory: (config: ConnectionConfig) => RemoteClient = createRemote,
    private readonly idleMs = 120_000
  ) {}

  async open(config: ConnectionConfig): Promise<{ id: string; info: ConnectInfo }> {
    const client = this.factory(config)
    const info = await client.connect()
    const id = randomUUID()
    this.sessions.set(id, { client, info, timer: this.idleTimer(id), tail: Promise.resolve() })
    return { id, info }
  }

  private idleTimer(id: string) {
    const t = setTimeout(() => void this.close(id), this.idleMs)
    t.unref?.()
    return t
  }

  async run<T>(id: string, fn: (client: RemoteClient, info: ConnectInfo) => Promise<T>): Promise<T> {
    const s = this.sessions.get(id)
    if (!s) throw new UserError('Forbindelsen til serveren ble lukket fordi den ikke var i bruk.', 'Trykk "Test tilkobling" igjen.')
    clearTimeout(s.timer)
    s.timer = this.idleTimer(id)
    const next = s.tail.then(() => fn(s.client, s.info))
    s.tail = next.catch(() => undefined)
    return next
  }

  async close(id: string): Promise<void> {
    const s = this.sessions.get(id)
    if (!s) return
    this.sessions.delete(id)
    clearTimeout(s.timer)
    await s.client.close()
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)))
  }

  get size(): number {
    return this.sessions.size
  }
}

import { FtpSrv, FileSystem } from 'ftp-srv'
import type { AddressInfo } from 'node:net'

/** Hooks for simulating problems. Mutate them during a test. */
export interface FaultHooks {
  /** Return true to cut the connection while this file is being written. */
  dropOnWrite?: (fileName: string) => boolean
  /** Return true to make writing this file fail with a permission error. */
  denyWrite?: (fileName: string) => boolean
}

export interface TestFtpServer {
  faults: FaultHooks
  port: number
  root: string
  username: string
  password: string
  close: () => Promise<void>
}

/** Start a local FTP server (ftp-srv) serving `root`. Never used against real servers. */
export async function startFtpServer(root: string, username = 'testbruker', password = 'test-passord-æøå'): Promise<TestFtpServer> {
  const server = new FtpSrv({
    url: 'ftp://127.0.0.1:0',
    pasv_url: '127.0.0.1',
    pasv_min: 40000,
    pasv_max: 49000,
    anonymous: false,
    greeting: 'Skyv testserver',
    log: silentLogger() as never
  })
  const faults: FaultHooks = {}
  class FaultyFileSystem extends FileSystem {
    write(fileName: string, opts?: { append?: boolean; start?: number }) {
      if (faults.denyWrite?.(fileName)) throw new Error('Permission denied')
      if (faults.dropOnWrite?.(fileName)) {
        // Cut the control connection before any data is stored, like a network drop.
        const conn = (this as unknown as { connection: { commandSocket?: { destroy(): void } } }).connection
        conn.commandSocket?.destroy()
        throw new Error('Connection lost')
      }
      return super.write(fileName, opts)
    }
  }
  server.on('login', ({ connection, username: u, password: p }, resolve, reject) => {
    if (u === username && p === password) resolve({ root, fs: new FaultyFileSystem(connection, { root, cwd: '/' }) as never })
    else reject(new Error('Login incorrect'))
  })
  await server.listen()
  const port = ((server as unknown as { server: { address(): AddressInfo } }).server.address()).port
  return {
    faults,
    port,
    root,
    username,
    password,
    close: async () => {
      await server.close()
    }
  }
}

function silentLogger() {
  const noop = () => undefined
  const logger: Record<string, unknown> = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop }
  logger.child = () => logger
  return logger
}

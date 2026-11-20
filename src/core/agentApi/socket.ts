import { createServer, connect, type Server, type Socket } from 'node:net'
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import type { ApiResponse, ClientInfo } from './api'

/** Socket file name inside the app's data folder. */
export const SOCKET_NAME = 'skyv.sock'

/** macOS allows at most 104 bytes in a Unix socket path. */
const MAX_SOCKET_PATH = 100

/**
 * Where the app listens. Normally `<data folder>/skyv.sock`. If that path is too long for a Unix
 * socket, a short path in `~/.skyv/` (a folder only the user can open) is used instead, derived
 * from the data folder so the bridge and command line find the same one in any environment.
 */
export function socketPathFor(dataDir: string, home = homedir()): string {
  const normal = join(dataDir, SOCKET_NAME)
  if (Buffer.byteLength(normal) <= MAX_SOCKET_PATH) return normal
  const id = createHash('sha256').update(dataDir).digest('hex').slice(0, 12)
  return join(home, '.skyv', `${id}.sock`)
}

export interface Request {
  id: number
  client: ClientInfo
  method: string
  params?: Record<string, unknown>
}

const MAX_REQUEST_BYTES = 1024 * 1024

export interface SocketServer {
  path: string
  close: () => Promise<void>
}

/**
 * Serve the agent API on a Unix socket (no network port). The socket file gets permissions 0600,
 * so only the same macOS user can connect. One JSON message per line in each direction.
 */
export async function startSocketServer(path: string, handle: (req: Request) => Promise<ApiResponse>): Promise<SocketServer> {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 })
  // A socket file left behind by a crash would block listening; remove it only if nobody answers.
  if (await fs.stat(path).then(() => true, () => false)) {
    const alive = await new Promise<boolean>((resolve) => {
      const s = connect(path)
      s.once('connect', () => {
        s.destroy()
        resolve(true)
      })
      s.once('error', () => resolve(false))
    })
    if (alive) throw new Error('Another Skyv is already listening')
    await fs.rm(path, { force: true })
  }

  const open = new Set<Socket>()
  const server: Server = createServer((socket: Socket) => {
    open.add(socket)
    socket.on('close', () => open.delete(socket))
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.destroy()
        return
      }
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (!line.trim()) continue
        let req: Request
        try {
          req = JSON.parse(line) as Request
        } catch {
          socket.write(JSON.stringify({ id: null, ok: false, error: { code: 'bad-request', message: 'Ugyldig melding.' } }) + '\n')
          continue
        }
        void handle(req).then(
          (res) => socket.writable && socket.write(JSON.stringify({ id: req.id, ...res }) + '\n'),
          () => socket.writable && socket.write(JSON.stringify({ id: req.id, ok: false, error: { code: 'failed', message: 'Noe uventet gikk galt i Skyv.' } }) + '\n')
        )
      }
    })
    socket.on('error', () => undefined)
  })

  // Create the socket with 0600 from the start (umask), then make sure with chmod.
  const oldMask = process.umask(0o177)
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(path, () => resolve())
    })
  } finally {
    process.umask(oldMask)
  }
  await fs.chmod(path, 0o600)

  return {
    path,
    close: () =>
      new Promise<void>((resolve) => {
        // Close open connections too, so stopping never waits on a connected AI client.
        for (const s of open) s.destroy()
        server.close(() => resolve())
        void fs.rm(path, { force: true })
      })
  }
}

export class NotRunningError extends Error {
  constructor() {
    super('Skyv is not running')
  }
}

/** Connection from the MCP bridge or the command line to the running app. */
export class SocketClient {
  private socket: Socket | null = null
  private nextId = 1
  private waiting = new Map<number, (r: ApiResponse) => void>()
  private buffer = ''

  constructor(
    private readonly path: string,
    /** Who is calling; a function so the bridge can report the AI client's name once it is known. */
    private readonly client: ClientInfo | (() => ClientInfo)
  ) {}

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const s = connect(this.path)
      s.setEncoding('utf8')
      s.once('connect', () => {
        this.socket = s
        resolve()
      })
      s.once('error', (err: NodeJS.ErrnoException) => reject(err.code === 'ENOENT' || err.code === 'ECONNREFUSED' ? new NotRunningError() : err))
      s.on('data', (chunk: string) => this.onData(chunk))
      s.on('close', () => {
        this.socket = null
        for (const done of this.waiting.values()) done({ ok: false, error: { code: 'failed', message: 'Forbindelsen til Skyv ble brutt.' } })
        this.waiting.clear()
      })
    })
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      try {
        const msg = JSON.parse(line) as { id: number } & ApiResponse
        const done = this.waiting.get(msg.id)
        if (done) {
          this.waiting.delete(msg.id)
          const { id: _id, ...res } = msg
          void _id
          done(res as ApiResponse)
        }
      } catch {
        /* ignore a broken line */
      }
    }
  }

  get connected(): boolean {
    return this.socket !== null
  }

  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 5 * 60_000): Promise<ApiResponse> {
    if (!this.socket) return Promise.resolve({ ok: false, error: { code: 'failed', message: 'Ikke koblet til Skyv.' } })
    const id = this.nextId++
    const req: Request = { id, client: typeof this.client === 'function' ? this.client() : this.client, method, params }
    return new Promise<ApiResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        resolve({ ok: false, error: { code: 'failed', message: 'Skyv svarte ikke i tide.', hint: 'Sjekk om Skyv venter på et svar fra deg.' } })
      }, timeoutMs)
      this.waiting.set(id, (r) => {
        clearTimeout(timer)
        resolve(r)
      })
      this.socket!.write(JSON.stringify(req) + '\n')
    })
  }

  close(): void {
    this.socket?.destroy()
    this.socket = null
  }
}

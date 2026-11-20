import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRemote, RemoteSessions } from '../src/core/remote'
import { detectRemoteRoot, readLocalTopLevel } from '../src/core/remote/detectRoot'
import { startFtpServer, type TestFtpServer } from './helpers/ftpServer'
import { makeTmpDir } from './helpers/tmp'

let server: TestFtpServer
let tmp: { dir: string; cleanup: () => Promise<void> }
let localSite: string

beforeAll(async () => {
  tmp = await makeTmpDir()
  const remoteRoot = join(tmp.dir, 'server')
  await mkdir(join(remoteRoot, 'public_html', 'css'), { recursive: true })
  await mkdir(join(remoteRoot, 'logs'), { recursive: true })
  await writeFile(join(remoteRoot, 'public_html', 'index.html'), '<h1>Gammel</h1>')
  await writeFile(join(remoteRoot, 'public_html', 'Kafé æøå.html'), 'x')
  localSite = join(tmp.dir, 'lokal')
  await mkdir(join(localSite, 'css'), { recursive: true })
  await writeFile(join(localSite, 'index.html'), '<h1>Ny</h1>')
  await writeFile(join(localSite, 'Kafé æøå.html'), 'y')
  server = await startFtpServer(remoteRoot)
})

afterAll(async () => {
  await server?.close()
  await tmp?.cleanup()
})

const config = () => ({
  protocol: 'ftp' as const,
  host: '127.0.0.1',
  port: server.port,
  username: server.username,
  password: server.password,
  timeoutMs: 15000
})

describe('FTP against local test server', () => {
  it('connects and lists folders, including Norwegian file names', async () => {
    const remote = createRemote(config())
    const info = await remote.connect()
    expect(info.homeDir).toBe('/')
    const root = await remote.list('/')
    expect(root.map((e) => e.name).sort()).toEqual(['logs', 'public_html'])
    const site = await remote.list('/public_html')
    expect(site.map((e) => e.name)).toContain('Kafé æøå.html')
    await remote.close()
  })

  it('gives a friendly message for a wrong password, without the password', async () => {
    const remote = createRemote({ ...config(), password: 'feil-passord-xyz' })
    const e = await remote.connect().then(
      () => null,
      (err) => err
    )
    expect(e?.message).toMatch(/Brukernavn eller passord/)
    expect(JSON.stringify({ m: e?.message, h: e?.hint })).not.toContain('feil-passord-xyz')
  })

  it('gives a friendly message when nothing listens on the port', async () => {
    // Port 1 is privileged and never has a listener, so the connection is always refused.
    // (Borrowing a free port can race with other tests that start servers in parallel.)
    const remote = createRemote({ ...config(), port: 1 })
    await expect(remote.connect()).rejects.toThrow(/svarte ikke/)
  })

  it('detects public_html as the web root', async () => {
    const remote = createRemote(config())
    const info = await remote.connect()
    const local = await readLocalTopLevel(localSite)
    const res = await detectRemoteRoot(remote, local, { startDir: info.homeDir })
    expect(res[0].path).toBe('/public_html')
    await remote.close()
  })

  it('keeps sessions and closes them', async () => {
    const sessions = new RemoteSessions(undefined, 60_000)
    const { id } = await sessions.open(config())
    const [a, b] = await Promise.all([
      sessions.run(id, (c) => c.list('/')),
      sessions.run(id, (c) => c.list('/public_html'))
    ])
    expect(a.length).toBe(2)
    expect(b.length).toBeGreaterThan(0)
    await sessions.close(id)
    expect(sessions.size).toBe(0)
    await expect(sessions.run(id, (c) => c.list('/'))).rejects.toThrow(/lukket/)
  })
})

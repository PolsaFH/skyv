import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { SiteWorkspace } from '../src/core/workspace'
import { createRemote } from '../src/core/remote'
import { DEFAULT_SETTINGS, type Site, type StartingPoint } from '../src/core/types'
import { startFtpServer, type TestFtpServer } from './helpers/ftpServer'
import { makeTmpDir } from './helpers/tmp'

let tmp: { dir: string; cleanup: () => Promise<void> }
let local: string
let serverRoot: string

function makeSite(startingPoint?: StartingPoint): Site {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'minside.no',
    localPath: local,
    protocol: 'ftp',
    host: '127.0.0.1',
    port: 21,
    username: 'u',
    remoteRoot: '/public_html',
    url: '',
    ignoreRules: '',
    settings: { ...DEFAULT_SETTINGS },
    startingPoint,
    createdAt: '',
    updatedAt: ''
  }
}

const sp = (choice: StartingPoint['choice']): StartingPoint => ({ choice, chosenAt: '2026-01-01', applied: false })

beforeEach(async () => {
  tmp = await makeTmpDir()
  local = join(tmp.dir, 'lokal')
  serverRoot = join(tmp.dir, 'server')
  await mkdir(join(local, 'css'), { recursive: true })
  await mkdir(join(local, 'bilder'), { recursive: true })
  await writeFile(join(local, 'index.html'), '<h1>Hei</h1>\n<p>Velkommen</p>\n')
  await writeFile(join(local, 'css', 'stil.css'), 'body{color:red}\n')
  await writeFile(join(local, 'bilder', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]))
  await mkdir(join(serverRoot, 'public_html', 'css'), { recursive: true })
})
afterEach(() => tmp.cleanup())

describe('workspace with local starting points', () => {
  it('"start here" records everything as given out, then shows later edits', async () => {
    const ws = new SiteWorkspace(makeSite(sp('assume-synced')), join(tmp.dir, 'data'))
    const first = await ws.scan()
    expect(first.changes).toEqual([])
    expect(first.needsStartingPoint).toBe(false)
    expect(first.fileCount).toBe(3)

    await writeFile(join(local, 'index.html'), '<h1>Hei</h1>\n<p>Velkommen til oss</p>\n')
    await rename(join(local, 'bilder', 'logo.png'), join(local, 'bilder', 'ny-logo.png'))
    await writeFile(join(local, 'kontakt.html'), 'kontakt')
    await rm(join(local, 'css', 'stil.css'))
    const second = await ws.scan()
    expect(second.changes.map((c) => `${c.kind}:${c.path}`).sort()).toEqual([
      'added:kontakt.html',
      'deleted:css/stil.css',
      'modified:index.html',
      'renamed:bilder/ny-logo.png'
    ])

    // Text diff uses the stored copy, no server needed.
    const d = await ws.diff(second.changes.find((c) => c.path === 'index.html')!)
    expect(d.kind).toBe('text')
    if (d.kind === 'text') {
      expect(d.oldMissing).toBe(false)
      expect(d.diff.rows.find((r) => r.kind === 'removed')?.text).toBe('<p>Velkommen</p>')
      expect(d.diff.rows.find((r) => r.kind === 'added')?.text).toBe('<p>Velkommen til oss</p>')
    }
    // Image diff gives a data URL for the new version.
    const img = await ws.diff(second.changes.find((c) => c.kind === 'renamed')!)
    expect(img.kind).toBe('image')
    if (img.kind === 'image') expect(img.after).toMatch(/^data:image\/png;base64,/)
  })

  it('"upload everything" lists all files as new', async () => {
    const ws = new SiteWorkspace(makeSite(sp('upload-all')), join(tmp.dir, 'data'))
    const res = await ws.scan()
    expect(res.changes).toHaveLength(3)
    expect(res.changes.every((c) => c.kind === 'added')).toBe(true)
  })

  it('without a starting point, asks the user to choose one', async () => {
    const ws = new SiteWorkspace(makeSite(), join(tmp.dir, 'data'))
    const res = await ws.scan()
    expect(res.needsStartingPoint).toBe(true)
    expect(res.changes).toEqual([])
  })

  it('refuses paths that try to leave the site folder', async () => {
    const ws = new SiteWorkspace(makeSite(sp('assume-synced')), join(tmp.dir, 'data'))
    expect(() => ws.localPath('../utenfor.txt')).toThrow()
  })

  it('gives a friendly message when the local folder is gone', async () => {
    const ws = new SiteWorkspace({ ...makeSite(sp('assume-synced')), localPath: join(tmp.dir, 'finnes-ikke') }, join(tmp.dir, 'data'))
    await expect(ws.scan()).rejects.toThrow(/Fant ikke mappen/)
  })
})

describe('compare with server (local test server)', () => {
  let server: TestFtpServer
  beforeEach(async () => {
    // Server: index.html same, stil.css same size but different content, extra.html only on server.
    await writeFile(join(serverRoot, 'public_html', 'index.html'), '<h1>Hei</h1>\n<p>Velkommen</p>\n')
    await writeFile(join(serverRoot, 'public_html', 'css', 'stil.css'), 'body{color:blu}\n')
    await writeFile(join(serverRoot, 'public_html', 'extra.html'), 'bare på serveren')
    server = await startFtpServer(serverRoot)
  })
  afterEach(() => server.close())

  const connect = async () => {
    const r = createRemote({ protocol: 'ftp', host: '127.0.0.1', port: server.port, username: server.username, password: server.password, timeoutMs: 15000 })
    await r.connect()
    return r
  }

  it('quick check treats same size as same', async () => {
    const ws = new SiteWorkspace(makeSite(sp('compare')), join(tmp.dir, 'data'))
    expect((await ws.scan()).needsCompare).toBe(true)
    const remote = await connect()
    const res = await ws.compareWithServer(remote, { deep: false })
    await remote.close()
    expect(res.sameSizeUnverified).toEqual(['css/stil.css', 'index.html'])
    expect(res.onlyLocal).toEqual(['bilder/logo.png'])
    expect(res.onlyRemote).toEqual(['extra.html'])
    const after = await ws.scan()
    expect(after.changes.map((c) => c.path)).toEqual(['bilder/logo.png'])
  })

  it('deep check downloads files with the same size and finds real differences', async () => {
    const ws = new SiteWorkspace(makeSite(sp('compare')), join(tmp.dir, 'data'))
    await ws.scan()
    const remote = await connect()
    const res = await ws.compareWithServer(remote, { deep: true })
    await remote.close()
    expect(res.same).toEqual(['index.html'])
    expect(res.different).toEqual(['css/stil.css'])
    const after = await ws.scan()
    expect(after.changes.map((c) => `${c.kind}:${c.path}`)).toEqual(['added:bilder/logo.png', 'modified:css/stil.css'])
    // The old version is not kept locally, so the diff must come from the server.
    const d = await ws.diff(after.changes.find((c) => c.path === 'css/stil.css')!)
    expect(d.kind === 'text' && d.oldMissing).toBe(true)
    // The server was not changed.
    expect(await readFile(join(serverRoot, 'public_html', 'extra.html'), 'utf8')).toBe('bare på serveren')
  })

  it('fetches the old version from the server when no copy is kept', async () => {
    const ws = new SiteWorkspace(makeSite(sp('compare')), join(tmp.dir, 'data'))
    await ws.scan()
    const remote = await connect()
    await ws.compareWithServer(remote, { deep: false })
    // Pretend the server copy of index.html is what was given out, but local copy store is empty.
    await rm(join(tmp.dir, 'data', 'published'), { recursive: true, force: true })
    await writeFile(join(local, 'index.html'), '<h1>Hei igjen</h1>\n<p>Velkommen</p>\n')
    const change = (await ws.scan()).changes.find((c) => c.path === 'index.html')!
    const fetchOld = async (remotePath: string) => {
      const dest = join(tmp.dir, 'old.skyvtmp')
      await remote.download(remotePath, dest)
      return readFile(dest)
    }
    const d = await ws.diff(change, fetchOld)
    await remote.close()
    expect(d.kind === 'text' && d.diff.rows.find((r) => r.kind === 'removed')?.text).toBe('<h1>Hei</h1>')
  })
})

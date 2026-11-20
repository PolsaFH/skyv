import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, readFile, rm, rename, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { SiteWorkspace } from '../src/core/workspace'
import { createRemote } from '../src/core/remote'
import { DEFAULT_SETTINGS, type Site } from '../src/core/types'
import { Publisher } from '../src/core/release/publisher'
import { undoRelease, planUndo } from '../src/core/release/undo'
import { ReleaseStore, SnapshotStore, Journal } from '../src/core/release/stores'
import { findConflicts } from '../src/core/release/conflicts'
import type { ReleaseProgress } from '../src/core/release/types'
import { startFtpServer, type TestFtpServer } from './helpers/ftpServer'
import { makeTmpDir } from './helpers/tmp'

let tmp: { dir: string; cleanup: () => Promise<void> }
let server: TestFtpServer
let local: string
let web: string
let dataDir: string

const ORIGINAL = {
  'index.html': '<h1>Gammel forside</h1>\n',
  'css/stil.css': 'body{color:black}\n',
  'gammel.html': '<p>skal slettes</p>\n',
  'om oss/Kafé æøå.html': '<p>om oss</p>\n',
  'logo.png': 'PNG-LOGO'
}

async function writeTree(root: string, files: Record<string, string>) {
  for (const [p, c] of Object.entries(files)) {
    await mkdir(join(root, p, '..'), { recursive: true })
    await writeFile(join(root, p), c)
  }
}

async function serverTree(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (dir: string, rel: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(join(dir, e.name), r)
      else out[r] = await readFile(join(dir, e.name), 'utf8')
    }
  }
  await walk(web, '')
  return out
}

function site(over: Partial<Site['settings']> = {}): Site {
  return {
    id: '00000000-0000-0000-0000-000000000002',
    name: 'test',
    localPath: local,
    protocol: 'ftp',
    host: '127.0.0.1',
    port: server.port,
    username: server.username,
    remoteRoot: '/www',
    url: '',
    ignoreRules: '',
    settings: { ...DEFAULT_SETTINGS, ...over },
    startingPoint: { choice: 'assume-synced', chosenAt: '', applied: false },
    createdAt: '',
    updatedAt: ''
  }
}

function setup(s: Site, events: ReleaseProgress[] = []) {
  const ws = new SiteWorkspace(s, dataDir)
  const deps = {
    site: s,
    workspace: ws,
    releases: new ReleaseStore(dataDir),
    snapshots: new SnapshotStore(dataDir),
    journal: new Journal(dataDir),
    connect: async () => {
      const c = createRemote({ protocol: 'ftp', host: '127.0.0.1', port: server.port, username: server.username, password: server.password, timeoutMs: 15000 })
      await c.connect()
      return c
    },
    retry: { attempts: 3, baseDelayMs: 10 },
    flushMs: 20,
    onProgress: (p: ReleaseProgress) => events.push(p)
  }
  return { ws, deps, publisher: () => new Publisher(deps) }
}

/** Typical AI round: edit, add, delete, rename. */
async function makeLocalChanges() {
  await writeFile(join(local, 'index.html'), '<h1>Ny forside</h1>\n')
  await writeTree(local, { 'bilder/ny mappe/hero æ.jpg': 'JPEG', 'kontakt.html': '<p>kontakt</p>\n' })
  await rm(join(local, 'gammel.html'))
  await rename(join(local, 'logo.png'), join(local, 'logo-ny.png'))
}

beforeEach(async () => {
  tmp = await makeTmpDir()
  local = join(tmp.dir, 'lokal')
  const root = join(tmp.dir, 'server')
  web = join(root, 'www')
  dataDir = join(tmp.dir, 'data')
  await writeTree(local, ORIGINAL)
  await writeTree(web, { ...ORIGINAL, 'bare-paa-server.txt': 'behold meg' })
  server = await startFtpServer(root)
})
afterEach(async () => {
  await server.close()
  await tmp.cleanup()
})

describe('publishing to the local test server', () => {
  it('uploads, renames and deletes selected changes, keeping a snapshot', async () => {
    const events: ReleaseProgress[] = []
    const { ws, deps, publisher } = setup(site(), events)
    await ws.scan()
    await makeLocalChanges()
    const changes = (await ws.scan()).changes
    expect(changes.map((c) => `${c.kind}:${c.path}`)).toEqual([
      'added:bilder/ny mappe/hero æ.jpg',
      'deleted:gammel.html',
      'modified:index.html',
      'added:kontakt.html',
      'renamed:logo-ny.png'
    ])

    const release = await publisher().publish(changes, 'Ny forside')
    expect(release.status).toBe('success')
    expect(release.items.every((i) => i.state === 'done')).toBe(true)

    const tree = await serverTree()
    expect(tree['index.html']).toBe('<h1>Ny forside</h1>\n')
    expect(tree['bilder/ny mappe/hero æ.jpg']).toBe('JPEG')
    expect(tree['kontakt.html']).toBe('<p>kontakt</p>\n')
    expect(tree['logo-ny.png']).toBe('PNG-LOGO')
    expect(tree['logo.png']).toBeUndefined()
    expect(tree['gammel.html']).toBeUndefined()
    expect(tree['bare-paa-server.txt']).toBe('behold meg')
    expect(Object.keys(tree).some((k) => k.includes('.skyvtmp'))).toBe(false)

    // Snapshot holds the old versions of overwritten and deleted files.
    const idx = await deps.snapshots.index(release.id)
    expect(Object.keys(idx.files).sort()).toEqual(['gammel.html', 'index.html', 'logo.png'])
    expect(await readFile(deps.snapshots.filePath(release.id, 'index.html'), 'utf8')).toBe('<h1>Gammel forside</h1>\n')

    // Manifest is up to date: nothing left to give out.
    expect((await ws.scan()).changes).toEqual([])
    const manifest = await ws.manifest.load()
    expect(manifest!.files['index.html'].remoteSize).toBe(20)
    expect(await deps.journal.get()).toBeNull()
    expect(events.at(-1)!.phase).toBe('done')
  })

  it('leaves unselected deletions alone', async () => {
    const { ws, publisher } = setup(site())
    await ws.scan()
    await makeLocalChanges()
    const changes = (await ws.scan()).changes.filter((c) => c.kind !== 'deleted')
    await publisher().publish(changes)
    expect((await serverTree())['gammel.html']).toBe('<p>skal slettes</p>\n')
    expect((await ws.scan()).changes.map((c) => c.kind)).toEqual(['deleted'])
  })

  it('retries when the connection drops during upload', async () => {
    const { ws, publisher } = setup(site())
    await ws.scan()
    await writeFile(join(local, 'index.html'), '<h1>Etter brudd</h1>\n')
    let drops = 0
    server.faults.dropOnWrite = (name) => name.includes('index.html') && drops++ < 1
    const release = await publisher().publish((await ws.scan()).changes)
    expect(drops).toBe(2)
    expect(release.status).toBe('success')
    expect((await serverTree())['index.html']).toBe('<h1>Etter brudd</h1>\n')
    expect(Object.keys(await serverTree()).some((k) => k.includes('.skyvtmp'))).toBe(false)
  })

  it('finishes the other files when one keeps failing, and can retry it later', async () => {
    const { ws, deps, publisher } = setup(site())
    await ws.scan()
    await makeLocalChanges()
    server.faults.denyWrite = (name) => name.includes('kontakt.html')
    const release = await publisher().publish((await ws.scan()).changes)
    expect(release.status).toBe('partial')
    const failed = release.items.filter((i) => i.state === 'failed')
    expect(failed.map((i) => i.path)).toEqual(['kontakt.html'])
    expect(failed[0].error).toBeTruthy()
    expect((await serverTree())['index.html']).toBe('<h1>Ny forside</h1>\n')
    // The failed file is still a pending change.
    expect((await ws.scan()).changes.map((c) => c.path)).toEqual(['kontakt.html'])

    server.faults.denyWrite = undefined
    const again = await new Publisher(deps).resume(release.id)
    expect(again.status).toBe('success')
    expect((await serverTree())['kontakt.html']).toBe('<p>kontakt</p>\n')
    expect((await ws.scan()).changes).toEqual([])
  })

  it('cleans up its own temp files left by an interrupted attempt', async () => {
    const { ws, publisher } = setup(site())
    await ws.scan()
    await writeFile(join(local, 'index.html'), '<h1>Ny</h1>')
    await writeFile(join(web, '.index.html.0a1b2c3d.skyvtmp'), 'halvferdig')
    await writeFile(join(web, '.index.html.skyvtmp-ikke-vaar'), 'ikke vår')
    await publisher().publish((await ws.scan()).changes)
    const tree = await serverTree()
    expect(tree['.index.html.0a1b2c3d.skyvtmp']).toBeUndefined()
    expect(tree['.index.html.skyvtmp-ikke-vaar']).toBe('ikke vår')
  })

  it('uses several connections at once', async () => {
    const { ws, publisher } = setup(site({ concurrency: 3 }))
    await ws.scan()
    for (let i = 0; i < 12; i++) await writeFile(join(local, `side-${i}.html`), `<p>${i}</p>`)
    const release = await publisher().publish((await ws.scan()).changes)
    expect(release.status).toBe('success')
    expect(Object.keys(await serverTree()).filter((k) => k.startsWith('side-'))).toHaveLength(12)
  })
})

describe('overwrite protection against the test server', () => {
  it('no false alarms after our own release, but notices when someone else changes a file', async () => {
    const { ws, deps, publisher } = setup(site())
    await ws.scan()
    await writeFile(join(local, 'index.html'), '<h1>Min versjon</h1>\n')
    await publisher().publish((await ws.scan()).changes)

    await writeFile(join(local, 'index.html'), '<h1>Min neste versjon</h1>\n')
    const changes = (await ws.scan()).changes
    const client = await deps.connect()
    try {
      expect(await findConflicts(changes, (await ws.manifest.load())!, client, '/www')).toEqual([])
      // Someone edits the file directly on the server (e.g. in the web host's file manager).
      await writeFile(join(web, 'index.html'), '<h1>Endret av noen andre på serveren</h1>\n')
      const conflicts = await findConflicts(changes, (await ws.manifest.load())!, client, '/www')
      expect(conflicts).toEqual([expect.objectContaining({ path: 'index.html', reason: 'changed-on-server' })])
      // The diff shows the server version against ours.
      const serverCopy = await deps.workspace.diffWithServer('index.html', Buffer.from(await readFile(join(web, 'index.html'))))
      expect(serverCopy.kind === 'text' && serverCopy.diff.rows.find((r) => r.kind === 'removed')?.text).toBe('<h1>Endret av noen andre på serveren</h1>')
    } finally {
      await client.close()
    }
  })
})

describe('undo', () => {
  it('restores the server exactly as it was before the release', async () => {
    const { ws, deps, publisher } = setup(site())
    await ws.scan()
    const before = await serverTree()
    await makeLocalChanges()
    const release = await publisher().publish((await ws.scan()).changes)

    const plan = planUndo(release)
    expect(plan).toEqual(
      expect.arrayContaining([
        { path: 'index.html', action: 'restore' },
        { path: 'kontakt.html', action: 'remove' },
        { path: 'gammel.html', action: 'restore' },
        { path: 'logo-ny.png', action: 'remove' },
        { path: 'logo.png', action: 'restore' }
      ])
    )

    const undone = await undoRelease(deps, release.id)
    expect(undone.status).toBe('undone')
    const after = await serverTree()
    // Empty folders may remain; files must match.
    expect(after).toEqual(before)
    // Local changes are pending again.
    expect((await ws.scan()).changes.map((c) => `${c.kind}:${c.path}`).sort()).toEqual([
      'added:bilder/ny mappe/hero æ.jpg',
      'added:kontakt.html',
      'deleted:gammel.html',
      'modified:index.html',
      'renamed:logo-ny.png'
    ])
  })

  it('can undo only selected files', async () => {
    const { ws, deps, publisher } = setup(site())
    await ws.scan()
    await makeLocalChanges()
    const release = await publisher().publish((await ws.scan()).changes)
    const res = await undoRelease(deps, release.id, ['index.html'])
    expect(res.status).toBe('partly-undone')
    const tree = await serverTree()
    expect(tree['index.html']).toBe('<h1>Gammel forside</h1>\n')
    expect(tree['kontakt.html']).toBe('<p>kontakt</p>\n')
    expect((await ws.scan()).changes.map((c) => c.path)).toEqual(['index.html'])
  })

  it('keeps only the newest snapshots and explains when undo is no longer possible', async () => {
    const { ws, deps } = setup(site({ snapshotKeep: 2 }))
    await ws.scan()
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      await writeFile(join(local, 'index.html'), `<h1>Versjon ${i}</h1>`)
      ids.push((await new Publisher(deps).publish((await ws.scan()).changes)).id)
      await new Promise((r) => setTimeout(r, 5))
    }
    const list = await deps.releases.list()
    expect(list.map((r) => r.snapshot)).toEqual(['kept', 'kept', 'pruned'])
    await expect(stat(deps.snapshots.dir(ids[0]))).rejects.toThrow()
    await expect(undoRelease(deps, ids[0])).rejects.toThrow(/kan ikke angres lenger/)
  })
})

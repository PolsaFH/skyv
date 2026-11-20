import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, readFile, rm, rename, readdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { findDeviations } from '../src/core/serverCheck/deviations'
import { runServerCheck, ServerCheckStore } from '../src/core/serverCheck/serverCheck'
import { resolveDeviation } from '../src/core/serverCheck/resolve'
import { emptyManifest } from '../src/core/manifest/manifest'
import { createIgnoreMatcher } from '../src/core/scan/ignoreRules'
import { SiteWorkspace } from '../src/core/workspace'
import { createRemote } from '../src/core/remote'
import { Publisher } from '../src/core/release/publisher'
import { ReleaseStore, SnapshotStore, Journal } from '../src/core/release/stores'
import { findConflicts } from '../src/core/release/conflicts'
import { DEFAULT_SETTINGS, type Site } from '../src/core/types'
import type { RemoteFile } from '../src/core/remote/listTree'
import { startFtpServer, type TestFtpServer } from './helpers/ftpServer'
import { makeTmpDir } from './helpers/tmp'

// ---------------------------------------------------------------- pure logic

function manifest(entries: Record<string, { size: number; remoteSize?: number; remoteMtimeMs?: number }>) {
  const m = emptyManifest()
  for (const [p, e] of Object.entries(entries)) m.files[p] = { hash: 'h', localMtimeMs: 1, publishedAt: '', ...e }
  return m
}
const remote = (...files: RemoteFile[]) => new Map(files.map((f) => [f.path, f]))

describe('finding deviations', () => {
  const base = {
    ignore: createIgnoreMatcher({ siteRules: 'utkast/' }),
    localPaths: new Set(['index.html', 'om.html', 'stil.css', 'logo.png'])
  }

  it('finds missing, changed and server-only files', () => {
    const res = findDeviations({
      ...base,
      reliableTimes: true,
      manifest: manifest({
        'index.html': { size: 10, remoteSize: 10, remoteMtimeMs: 1_000_000 },
        'om.html': { size: 5, remoteSize: 5, remoteMtimeMs: 1_000_000 },
        'stil.css': { size: 7, remoteSize: 7, remoteMtimeMs: 1_000_000 },
        'logo.png': { size: 3, remoteSize: 3, remoteMtimeMs: 1_000_000 }
      }),
      remote: remote(
        { path: 'index.html', size: 10, modifiedAt: 1_000_400 }, // within tolerance
        { path: 'om.html', size: 5, modifiedAt: 9_000_000 }, // same size, newer time
        { path: 'stil.css', size: 99, modifiedAt: 1_000_000 }, // other size
        { path: 'gammel-kopi.html', size: 4 }
      )
    })
    expect(res.map((d) => `${d.kind}:${d.path}`)).toEqual(['missing:logo.png', 'changed:om.html', 'changed:stil.css', 'server-only:gammel-kopi.html'])
    expect(res[0].existsLocally).toBe(true)
  })

  it('without exact server times, only size counts (same-size edits are not visible)', () => {
    const res = findDeviations({
      ...base,
      reliableTimes: false,
      manifest: manifest({ 'om.html': { size: 5, remoteSize: 5, remoteMtimeMs: 1_000_000 }, 'stil.css': { size: 7 } }),
      remote: remote({ path: 'om.html', size: 5, modifiedAt: 9_000_000 })
    })
    expect(res.map((d) => `${d.kind}:${d.path}`)).toEqual(['missing:stil.css'])
  })

  it('never reports ignored files, Skyv temp files, dismissed files or files in unreadable folders', () => {
    const res = findDeviations({
      ...base,
      reliableTimes: true,
      manifest: manifest({ 'utkast/a.html': { size: 1 }, 'privat/b.html': { size: 1 } }),
      remote: remote(
        { path: '.env', size: 3 },
        { path: 'node_modules/x/y.js', size: 3 },
        { path: 'utkast/c.html', size: 3 },
        { path: '.index.html.0a1b2c3d.skyvtmp', size: 3 },
        { path: 'latt-vaere.txt', size: 3 }
      ),
      dismissed: new Set(['latt-vaere.txt']),
      unlistedFolders: ['privat']
    })
    expect(res).toEqual([])
  })

  it('matches names with Norwegian letters in either Unicode form', () => {
    const nfd = 'kafé.html'.normalize('NFD')
    const res = findDeviations({ ...base, localPaths: new Set(['kafé.html']), reliableTimes: false, manifest: manifest({ 'kafé.html': { size: 1 } }), remote: remote({ path: nfd, size: 1 }) })
    expect(res).toEqual([])
  })

  it('tells which pages use a deviating file', () => {
    const res = findDeviations({
      ...base,
      reliableTimes: false,
      manifest: manifest({ 'logo.png': { size: 3 } }),
      remote: remote(),
      usedBy: new Map([['logo.png', new Set(['index.html', 'om.html'])]])
    })
    expect(res[0].usedBy).toEqual(['index.html', 'om.html'])
  })

  it('handles 5000 files in well under a second', () => {
    const files: Record<string, { size: number; remoteSize: number }> = {}
    const list: RemoteFile[] = []
    for (let i = 0; i < 5000; i++) {
      files[`mappe-${i % 50}/side-${i}.html`] = { size: 100, remoteSize: 100 }
      if (i % 100 !== 0) list.push({ path: `mappe-${i % 50}/side-${i}.html`, size: i % 250 === 1 ? 101 : 100 })
    }
    const t0 = performance.now()
    const res = findDeviations({ ...base, localPaths: new Set(Object.keys(files)), reliableTimes: false, manifest: manifest(files), remote: remote(...list) })
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(res.filter((d) => d.kind === 'missing')).toHaveLength(50)
    expect(res.filter((d) => d.kind === 'changed')).toHaveLength(20)
  })
})

// ---------------------------------------------------------------- against the local FTP test server

let tmp: { dir: string; cleanup: () => Promise<void> }
let server: TestFtpServer
let local: string
let web: string
let dataDir: string
let trashDir: string

const FILES: Record<string, string> = {
  'index.html': '<link rel="stylesheet" href="stil.css"><img src="bilder/logo.png"><h1>Hei</h1>\n',
  'om.html': '<h1>Om oss</h1>\n',
  'stil.css': 'body{}\n',
  'bilder/logo.png': 'PNG-LOGO'
}

async function writeTree(root: string, files: Record<string, string>) {
  for (const [p, c] of Object.entries(files)) {
    await mkdir(join(root, p, '..'), { recursive: true })
    await writeFile(join(root, p), c)
  }
}

function setup() {
  const site: Site = {
    id: '00000000-0000-0000-0000-00000000000a',
    name: 'avvik',
    localPath: local,
    protocol: 'ftp',
    host: '127.0.0.1',
    port: server.port,
    username: server.username,
    remoteRoot: '/www',
    url: '',
    ignoreRules: '',
    settings: { ...DEFAULT_SETTINGS },
    startingPoint: { choice: 'assume-synced', chosenAt: '', applied: false },
    createdAt: '',
    updatedAt: ''
  }
  const ws = new SiteWorkspace(site, dataDir)
  const store = new ServerCheckStore(dataDir)
  const connect = async () => {
    const c = createRemote({ protocol: 'ftp', host: '127.0.0.1', port: server.port, username: server.username, password: server.password, timeoutMs: 15000 })
    await c.connect()
    return c
  }
  const trashed: string[] = []
  const trash = async (abs: string) => {
    trashed.push(abs)
    await mkdir(trashDir, { recursive: true })
    await rename(abs, join(trashDir, `${Date.now()}-${basename(abs)}`))
  }
  const check = async () => {
    const c = createRemote({ protocol: 'ftp', host: '127.0.0.1', port: server.port, username: server.username, password: server.password, timeoutMs: 15000 })
    const info = await c.connect()
    try {
      return await runServerCheck(ws, '/www', c, info, store)
    } finally {
      await c.close()
    }
  }
  const releaseDeps = { site, workspace: ws, releases: new ReleaseStore(dataDir), snapshots: new SnapshotStore(dataDir), journal: new Journal(dataDir), connect, retry: { attempts: 2, baseDelayMs: 10 }, flushMs: 20 }
  const resolveDeps = { workspace: ws, remoteRoot: '/www', store, connect, trash }
  return { ws, store, check, trashed, releaseDeps, resolveDeps }
}

beforeEach(async () => {
  tmp = await makeTmpDir()
  local = join(tmp.dir, 'lokal')
  web = join(tmp.dir, 'server', 'www')
  dataDir = join(tmp.dir, 'data')
  trashDir = join(tmp.dir, 'Papirkurv')
  await writeTree(local, FILES)
  await writeTree(web, FILES)
  server = await startFtpServer(join(tmp.dir, 'server'))
})
afterEach(async () => {
  await server.close()
  await tmp.cleanup()
})

describe('server check against the test server', () => {
  it('finds a file deleted, a file edited and a file added on the server, but never ignored files', async () => {
    const { ws, check } = setup()
    await ws.scan()
    expect((await check()).deviations).toEqual([])

    await rm(join(web, 'bilder', 'logo.png')) // deleted in FileZilla
    await writeFile(join(web, 'om.html'), '<h1>Om oss, endret i webhotellets filbehandler</h1>\n')
    await writeFile(join(web, 'kopi-av-index.html'), 'kopi')
    await writeTree(web, { '.env': 'SECRET=x', 'node_modules/x/y.js': 'x', '.htaccess.0a1b2c3d.skyvtmp': 'rest' })

    const res = await check()
    expect(res.deviations.map((d) => `${d.kind}:${d.path}`)).toEqual(['missing:bilder/logo.png', 'changed:om.html', 'server-only:kopi-av-index.html'])
    expect(res.deviations[0].usedBy).toEqual(['index.html'])
    // The test server has no MLSD: Skyv must know that times are not reliable.
    expect(res.reliableTimes).toBe(false)
    // The result is stored, so the app can show "Sjekket for 2 minutter siden".
    expect((await new ServerCheckStore(dataDir).last())?.deviations).toHaveLength(3)
  })

  it('without MLSD, deletions are still found but a same-size edit is not', async () => {
    const { ws, check } = setup()
    await ws.scan()
    await writeFile(join(web, 'stil.css'), 'html{}\n') // same length as "body{}\n"
    await rm(join(web, 'om.html'))
    const res = await check()
    expect(res.reliableTimes).toBe(false)
    expect(res.deviations.map((d) => `${d.kind}:${d.path}`)).toEqual(['missing:om.html'])
  })

  it('lists 5000 files over FTP and compares them in under a second', async () => {
    const big: Record<string, string> = {}
    for (let i = 0; i < 5000; i++) big[`m${i % 10}/s${i}.html`] = 'x'
    await writeTree(local, big)
    await writeTree(web, big)
    const { ws, check } = setup()
    await ws.scan()
    await rm(join(web, 'm3', 's3.html'))
    const t0 = performance.now()
    const res = await check()
    const ms = performance.now() - t0
    console.log(`server check of ${res.remoteFileCount} files in ${res.folderCount} folders: ${Math.round(ms)} ms`)
    expect(res.deviations.map((d) => d.path)).toEqual(['m3/s3.html'])
    expect(ms).toBeLessThan(1000)
  })
})

describe('choices for each deviation', () => {
  it('"Last opp på nytt" puts a missing file back through a normal release', async () => {
    const { ws, check, resolveDeps, releaseDeps } = setup()
    await ws.scan()
    await rm(join(web, 'bilder', 'logo.png'))
    const d = (await check()).deviations[0]
    const r = await resolveDeviation(resolveDeps, d, 'reupload')
    expect(r.release).toEqual(['bilder/logo.png'])
    const changes = (await ws.scan()).changes
    expect(changes.map((c) => `${c.kind}:${c.path}`)).toEqual(['added:bilder/logo.png'])
    await new Publisher(releaseDeps).publish(changes)
    expect(await readFile(join(web, 'bilder', 'logo.png'), 'utf8')).toBe('PNG-LOGO')
    expect((await check()).deviations).toEqual([])
  })

  it('"Slett den på Macen også" moves the file to the Trash, never deletes it', async () => {
    const { ws, check, resolveDeps, trashed } = setup()
    await ws.scan()
    await rm(join(web, 'om.html'))
    const d = (await check()).deviations[0]
    await resolveDeviation(resolveDeps, d, 'delete-local')
    expect(trashed).toEqual([join(local, 'om.html')])
    await expect(stat(join(local, 'om.html'))).rejects.toThrow()
    expect((await readdir(trashDir)).some((n) => n.endsWith('om.html'))).toBe(true)
    expect((await ws.scan()).changes).toEqual([])
  })

  it('"La den være borte" forgets the file, so it shows up as new if it is still on the Mac', async () => {
    const { ws, check, resolveDeps } = setup()
    await ws.scan()
    await rm(join(web, 'om.html'))
    const d = (await check()).deviations[0]
    await resolveDeviation(resolveDeps, d, 'let-go')
    expect((await ws.scan()).changes.map((c) => `${c.kind}:${c.path}`)).toEqual(['added:om.html'])
    expect((await new ServerCheckStore(dataDir).last())?.deviations).toEqual([])
  })

  it('"Hent serverens versjon til Macen" puts the Mac version in the Trash first', async () => {
    const { ws, check, resolveDeps, trashed } = setup()
    await ws.scan()
    await writeFile(join(web, 'om.html'), '<h1>Serverens nye tekst</h1>\n')
    const d = (await check()).deviations[0]
    await resolveDeviation(resolveDeps, d, 'fetch-server')
    expect(await readFile(join(local, 'om.html'), 'utf8')).toBe('<h1>Serverens nye tekst</h1>\n')
    expect(trashed).toEqual([join(local, 'om.html')])
    const inTrash = (await readdir(trashDir)).find((n) => n.endsWith('om.html'))!
    expect(await readFile(join(trashDir, inTrash), 'utf8')).toBe('<h1>Om oss</h1>\n')
    expect((await ws.scan()).changes).toEqual([])
    expect((await check()).deviations).toEqual([])
    // No temporary files left in the site folder.
    expect((await readdir(local)).some((n) => n.includes('skyv'))).toBe(false)
  })

  it('"Overskriv med min versjon" sends the Mac version in the next release, with a backup of the server version', async () => {
    const { ws, check, resolveDeps, releaseDeps } = setup()
    await ws.scan()
    await writeFile(join(web, 'om.html'), '<h1>Endret på serveren, lengre tekst</h1>\n')
    const d = (await check()).deviations[0]
    await resolveDeviation(resolveDeps, d, 'overwrite-mine')
    const changes = (await ws.scan()).changes
    expect(changes.map((c) => `${c.kind}:${c.path}`)).toEqual(['modified:om.html'])
    // The choice counts as an answer to the conflict, so the release is not stopped again.
    const client = await releaseDeps.connect()
    expect(await findConflicts(changes, (await ws.manifest.load())!, client, '/www')).toEqual([])
    await client.close()
    const rel = await new Publisher(releaseDeps).publish(changes)
    expect(await readFile(join(web, 'om.html'), 'utf8')).toBe('<h1>Om oss</h1>\n')
    expect(await readFile(releaseDeps.snapshots.filePath(rel.id, 'om.html'), 'utf8')).toBe('<h1>Endret på serveren, lengre tekst</h1>\n')
  })

  it('"Hent til Macen" downloads a server-only file, and refuses to overwrite a file on the Mac', async () => {
    const { ws, check, resolveDeps } = setup()
    await ws.scan()
    await writeTree(web, { 'nedlastinger/meny.pdf': 'PDF' })
    const d = (await check()).deviations[0]
    expect(d.kind).toBe('server-only')
    await resolveDeviation(resolveDeps, d, 'fetch-to-mac')
    expect(await readFile(join(local, 'nedlastinger', 'meny.pdf'), 'utf8')).toBe('PDF')
    expect((await ws.scan()).changes).toEqual([])

    await writeFile(join(web, 'ny.html'), 'server')
    const d2 = (await check()).deviations[0]
    await writeFile(join(local, 'ny.html'), 'mac') // appears on the Mac after the check
    await expect(resolveDeviation(resolveDeps, d2, 'fetch-to-mac')).rejects.toThrow(/finnes allerede/)
    expect(await readFile(join(local, 'ny.html'), 'utf8')).toBe('mac')
  })

  it('"La være" is remembered, so the file is not shown again', async () => {
    const { ws, check, resolveDeps } = setup()
    await ws.scan()
    await writeFile(join(web, 'statistikk.txt'), 'x')
    const d = (await check()).deviations[0]
    await resolveDeviation(resolveDeps, d, 'dismiss')
    expect((await check()).deviations).toEqual([])
    expect(await readFile(join(web, 'statistikk.txt'), 'utf8')).toBe('x')
  })

  it('refuses choices that do not fit the kind of deviation', async () => {
    const { ws, check, resolveDeps } = setup()
    await ws.scan()
    await rm(join(web, 'om.html'))
    const d = (await check()).deviations[0]
    await expect(resolveDeviation(resolveDeps, d, 'fetch-to-mac')).rejects.toThrow(/passer ikke/)
  })
})

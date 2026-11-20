import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SiteWorkspace } from '../src/core/workspace'
import { createRemote } from '../src/core/remote'
import { DEFAULT_SETTINGS, type Site } from '../src/core/types'
import { Publisher } from '../src/core/release/publisher'
import { ReleaseStore, SnapshotStore, Journal } from '../src/core/release/stores'
import { verifyRelease } from '../src/core/verify/verifyRelease'
import { createFetcher } from '../src/core/verify/fetcher'
import { findPhp, startPhpServer, type PhpServer } from '../src/core/php/php'
import { startFtpServer, type TestFtpServer } from './helpers/ftpServer'
import { makeTmpDir } from './helpers/tmp'

// Full round trip: upload over FTP, serve the uploaded files with PHP's built-in web server,
// and check the "live" site. Runs only where PHP is installed.
const php = await findPhp()

describe.runIf(php)('check after upload (FTP test server + PHP web server)', () => {
  let tmp: { dir: string; cleanup: () => Promise<void> }
  let ftp: TestFtpServer
  let web: PhpServer
  let local: string
  let docroot: string

  beforeEach(async () => {
    tmp = await makeTmpDir()
    local = join(tmp.dir, 'lokal')
    docroot = join(tmp.dir, 'server', 'www')
    for (const root of [local, docroot]) {
      await mkdir(join(root, 'inc'), { recursive: true })
      await writeFile(join(root, 'index.php'), "<?php include __DIR__ . '/inc/meny.php'; ?>\n<h1>Forside</h1>\n<link rel=\"stylesheet\" href=\"stil.css\">\n")
      await writeFile(join(root, 'inc', 'meny.php'), '<nav>Meny</nav>\n')
      await writeFile(join(root, 'stil.css'), 'body{}\n')
    }
    ftp = await startFtpServer(join(tmp.dir, 'server'))
    web = await startPhpServer(php!.path, docroot, undefined, ['-d', 'display_errors=1', '-d', 'error_reporting=E_ALL'])
  })
  afterEach(async () => {
    await web.stop()
    await ftp.close()
    await tmp.cleanup()
  })

  function setup(autoUndo: boolean) {
    const site: Site = {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'test',
      localPath: local,
      protocol: 'ftp',
      host: '127.0.0.1',
      port: ftp.port,
      username: ftp.username,
      remoteRoot: '/www',
      url: web.url,
      ignoreRules: '',
      settings: { ...DEFAULT_SETTINGS, autoUndoOnFailedCheck: autoUndo },
      startingPoint: { choice: 'assume-synced', chosenAt: '', applied: false },
      createdAt: '',
      updatedAt: ''
    }
    const dataDir = join(tmp.dir, 'data')
    const workspace = new SiteWorkspace(site, dataDir)
    const deps = {
      site,
      workspace,
      releases: new ReleaseStore(dataDir),
      snapshots: new SnapshotStore(dataDir),
      journal: new Journal(dataDir),
      connect: async () => {
        const c = createRemote({ protocol: 'ftp', host: '127.0.0.1', port: ftp.port, username: ftp.username, password: ftp.password, timeoutMs: 15000 })
        await c.connect()
        return c
      },
      retry: { attempts: 2, baseDelayMs: 10 },
      flushMs: 20
    }
    return { workspace, deps }
  }

  it('passes when the site works, also when only an include changed', async () => {
    const { workspace, deps } = setup(false)
    await workspace.scan()
    await writeFile(join(local, 'inc', 'meny.php'), '<nav>Ny meny</nav>\n')
    const release = await new Publisher(deps).publish((await workspace.scan()).changes)
    const checked = await verifyRelease(deps, release, createFetcher(5000))
    expect(checked.check?.ok).toBe(true)
    expect(checked.check?.pages.map((p) => [p.path, p.reason, p.status])).toEqual([['index.php', 'uses-changed', 200]])
    expect(checked.check?.assets.map((a) => new URL(a.url).pathname)).toEqual(['/stil.css'])
  })

  it('finds a PHP error on the live page and undoes automatically when that is turned on', async () => {
    const { workspace, deps } = setup(true)
    await workspace.scan()
    await writeFile(join(local, 'inc', 'meny.php'), '<nav><?php echo finnes_ikke(); ?></nav>\n')
    const release = await new Publisher(deps).publish((await workspace.scan()).changes)
    const checked = await verifyRelease(deps, release, createFetcher(5000))
    expect(checked.check?.ok).toBe(false)
    expect(checked.check?.pages[0].problems.join(' ')).toMatch(/PHP-feil|Uncaught/)
    expect(checked.check?.autoUndone).toBe(true)
    expect(checked.status).toBe('undone')
    // The working version is back on the server.
    expect(await readFile(join(docroot, 'inc', 'meny.php'), 'utf8')).toBe('<nav>Meny</nav>\n')
    // And the saved release remembers both the failed check and the undo.
    const saved = await deps.releases.get(release.id)
    expect(saved?.check?.autoUndone).toBe(true)
  })

  it('does not undo automatically when the setting is off', async () => {
    const { workspace, deps } = setup(false)
    await workspace.scan()
    await writeFile(join(local, 'index.php'), '<link rel="stylesheet" href="borte.css"><h1>Hei</h1>\n')
    const release = await new Publisher(deps).publish((await workspace.scan()).changes)
    const checked = await verifyRelease(deps, release, createFetcher(5000))
    expect(checked.check?.ok).toBe(false)
    // PHP's web server answers missing files with the front page (like many web hosts): a "soft 404".
    expect(checked.check?.assets.find((a) => !a.ok)?.problem).toMatch(/404|nettside i stedet/)
    expect(checked.status).toBe('success')
    expect(checked.check?.autoUndone).toBeUndefined()
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SiteLog } from '../src/core/log/siteLog'
import { SiteStore } from '../src/core/sites/siteStore'
import { SiteService } from '../src/core/sites/siteService'
import { SecretStore } from '../src/core/secrets/secretStore'
import { exportSites, importSites, parseExport } from '../src/core/transfer/exportImport'
import { makeTmpDir, fakeEncryptor } from './helpers/tmp'

let cleanup: () => Promise<void> = async () => {}
afterEach(() => cleanup())

describe('site log', () => {
  it('appends entries, lists newest first and never writes known secrets', async () => {
    const t = await makeTmpDir()
    cleanup = t.cleanup
    const log = new SiteLog(t.dir, async () => ['passord-123'])
    await log.add('release', 'Ga ut 2 endringer.', ['index.html', 'om.html'])
    await log.add('undo', 'Angret utgivelsen. Feil: passord-123 ble avvist')
    const list = await log.list()
    expect(list.map((e) => e.action)).toEqual(['undo', 'release'])
    expect(list[1].details).toEqual(['index.html', 'om.html'])
    const raw = await readFile(join(t.dir, 'log.jsonl'), 'utf8')
    expect(raw).not.toContain('passord-123')
    expect(SiteLog.toText(list)).toContain('Ga ut 2 endringer.')
  })

  it('keeps the log from growing forever', async () => {
    const t = await makeTmpDir()
    cleanup = t.cleanup
    const log = new SiteLog(t.dir)
    const big = 'x'.repeat(5000)
    for (let i = 0; i < 260; i++) await log.add('check', `${i} ${big}`)
    const raw = await readFile(join(t.dir, 'log.jsonl'), 'utf8')
    expect(raw.length).toBeLessThan(1024 * 1024 + 10000)
    expect((await log.list(1))[0].message.startsWith('259 ')).toBe(true)
  })
})

describe('export and import', () => {
  it('exports without passwords and imports on another Mac', async () => {
    const t = await makeTmpDir()
    cleanup = t.cleanup
    const folder = join(t.dir, 'kafe.no')
    await mkdir(folder)
    const store = new SiteStore(join(t.dir, 'mac1'))
    const service = new SiteService(store, new SecretStore(join(t.dir, 'mac1', 'secrets'), fakeEncryptor))
    await service.create({ localPath: folder, host: 'ftp.kafe.no', username: 'kafe', remoteRoot: '/www', url: 'https://kafe.no', ignoreRules: 'utkast/' }, 'superhemmelig-passord')
    await service.create({ localPath: join(t.dir, 'finnes-ikke'), host: 'ftp.annen.no', username: 'x' })

    const file = exportSites(await store.list())
    const text = JSON.stringify(file)
    expect(text).not.toContain('superhemmelig')
    expect(text).not.toContain('password')

    const exportPath = join(t.dir, 'skyv.json')
    await writeFile(exportPath, text)
    const store2 = new SiteStore(join(t.dir, 'mac2'))
    const res = await importSites(store2, parseExport(await readFile(exportPath, 'utf8')))
    expect(res.imported).toEqual(['kafe.no', 'finnes-ikke'])
    expect(res.missingFolder).toEqual(['finnes-ikke'])
    const imported = (await store2.list()).find((s) => s.name === 'kafe.no')!
    expect([imported.host, imported.remoteRoot, imported.url, imported.ignoreRules]).toEqual(['ftp.kafe.no', '/www', 'https://kafe.no', 'utkast/'])
    expect(imported.startingPoint).toBeUndefined()

    // Importing again skips what is already there.
    const again = await importSites(store2, file)
    expect(again.imported).toEqual([])
    expect(again.skipped.map((s) => s.reason)).toEqual(['finnes allerede i Skyv', 'finnes allerede i Skyv'])
  })

  it('refuses files that are not Skyv exports', () => {
    expect(() => parseExport('{"hei":1}')).toThrow(/ikke en eksportfil/)
    expect(() => parseExport('ikke json')).toThrow(/kunne ikke leses/)
  })
})

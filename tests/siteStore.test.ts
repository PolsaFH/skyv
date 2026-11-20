import { describe, it, expect, afterEach } from 'vitest'
import { mkdir, readFile, stat, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { SiteStore, normalizeHost, normalizeRemoteRoot, normalizeUrl, suggestNameFromFolder } from '../src/core/sites/siteStore'
import { SiteService } from '../src/core/sites/siteService'
import { SecretStore } from '../src/core/secrets/secretStore'
import { makeTmpDir, fakeEncryptor } from './helpers/tmp'

let cleanup: () => Promise<void> = async () => {}
afterEach(() => cleanup())

async function setup() {
  const t = await makeTmpDir()
  cleanup = t.cleanup
  const data = join(t.dir, 'userData')
  const siteFolder = join(t.dir, 'Nettsider', 'kafé-æøå.no')
  await mkdir(siteFolder, { recursive: true })
  await writeFile(join(siteFolder, 'index.html'), '<h1>Hei</h1>')
  const store = new SiteStore(data)
  const secrets = new SecretStore(join(data, 'secrets'), fakeEncryptor)
  return { data, siteFolder, store, secrets, service: new SiteService(store, secrets) }
}

describe('normalisation helpers', () => {
  it('suggests name from folder', () => {
    expect(suggestNameFromFolder('/Users/x/minside.no/')).toBe('minside.no')
    expect(suggestNameFromFolder('/Users/x/Kafé Ålesund')).toBe('Kafé Ålesund')
  })
  it('normalises remote root and rejects ..', () => {
    expect(normalizeRemoteRoot('public_html/')).toBe('/public_html')
    expect(normalizeRemoteRoot('')).toBe('/')
    expect(normalizeRemoteRoot('/a//./b')).toBe('/a/b')
    expect(() => normalizeRemoteRoot('/a/../etc')).toThrow()
  })
  it('normalises host', () => {
    expect(normalizeHost(' ftp://FTP.Minside.no:21/public_html ')).toBe('ftp.minside.no')
  })
  it('normalises url', () => {
    expect(normalizeUrl('minside.no')).toBe('https://minside.no')
    expect(normalizeUrl('http://minside.no/')).toBe('http://minside.no')
    expect(normalizeUrl('')).toBe('')
  })
})

describe('SiteStore', () => {
  it('creates, lists, updates and persists sites', async () => {
    const { data, siteFolder, store } = await setup()
    const site = await store.create({ localPath: siteFolder, host: 'ftp.kafe.no', username: 'kafe' })
    expect(site.name).toBe('kafé-æøå.no')
    expect(site.port).toBe(21)
    expect(site.settings.concurrency).toBe(3)

    const updated = await store.update(site.id, { protocol: 'sftp', remoteRoot: 'www' })
    expect(updated.port).toBe(22)
    expect(updated.remoteRoot).toBe('/www')

    const fresh = new SiteStore(data)
    const list = await fresh.list()
    expect(list).toHaveLength(1)
    expect(list[0].protocol).toBe('sftp')
  })

  it('refuses the same folder twice', async () => {
    const { siteFolder, store } = await setup()
    await store.create({ localPath: siteFolder })
    await expect(store.create({ localPath: siteFolder + '/' })).rejects.toThrow(/allerede/)
  })

  it('validates port', async () => {
    const { store } = await setup()
    await expect(store.create({ port: 70000 })).rejects.toThrow(/Porten/)
  })

  it('remove deletes only app data, never the local site folder', async () => {
    const { data, siteFolder, store } = await setup()
    const site = await store.create({ localPath: siteFolder })
    await writeFile(join(store.siteDir(site.id), 'releases.json'), '[]')
    await store.remove(site.id)
    expect(await store.list()).toHaveLength(0)
    await expect(stat(join(data, 'sites', site.id))).rejects.toThrow()
    expect(await readFile(join(siteFolder, 'index.html'), 'utf8')).toBe('<h1>Hei</h1>')
  })

  it('rejects malformed ids for site folders', async () => {
    const { store } = await setup()
    expect(() => store.siteDir('../../etc')).toThrow()
  })
})

describe('SiteService and passwords', () => {
  it('stores passwords encrypted, never in sites.json', async () => {
    const { data, siteFolder, service } = await setup()
    const view = await service.create({ localPath: siteFolder, host: 'ftp.kafe.no' }, 'hemmelig-passord-123')
    expect(view.hasPassword).toBe(true)
    expect(JSON.stringify(view)).not.toContain('hemmelig')

    const sitesJson = await readFile(join(data, 'sites.json'), 'utf8')
    expect(sitesJson).not.toContain('hemmelig')
    for (const f of await readdir(join(data, 'secrets'))) {
      const raw = await readFile(join(data, 'secrets', f))
      expect(raw.toString('utf8')).not.toContain('hemmelig')
    }
    expect(await service.getPassword(view.id)).toBe('hemmelig-passord-123')
  })

  it('keeps, replaces and clears passwords', async () => {
    const { siteFolder, service } = await setup()
    const v = await service.create({ localPath: siteFolder }, 'a1b2c3')
    await service.update(v.id, { name: 'Nytt navn' })
    expect(await service.getPassword(v.id)).toBe('a1b2c3')
    await service.update(v.id, {}, 'ny-æøå')
    expect(await service.getPassword(v.id)).toBe('ny-æøå')
    const cleared = await service.update(v.id, {}, null)
    expect(cleared.hasPassword).toBe(false)
  })

  it('removes the password when the site is removed', async () => {
    const { siteFolder, service } = await setup()
    const v = await service.create({ localPath: siteFolder }, 'pw-123')
    await service.remove(v.id)
    expect(await service.getPassword(v.id)).toBeUndefined()
  })

  it('refuses to store when keychain is unavailable', async () => {
    const { siteFolder, service } = await setup()
    fakeEncryptor.available = false
    try {
      await expect(service.create({ localPath: siteFolder }, 'pw-123')).rejects.toThrow(/nøkkelringen/)
    } finally {
      fakeEncryptor.available = true
    }
  })
})

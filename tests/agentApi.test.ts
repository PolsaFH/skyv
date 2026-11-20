import { describe, it, expect, afterEach } from 'vitest'
import { mkdir, writeFile, stat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentApi, identifyClient, scrubSecrets } from '../src/core/agentApi/api'
import { registerReadMethods } from '../src/core/agentApi/methods'
import { startSocketServer, SocketClient, NotRunningError, socketPathFor, type SocketServer } from '../src/core/agentApi/socket'
import { createServices } from './helpers/services'
import { makeTmpDir } from './helpers/tmp'

const PASSWORD = 'superHemmelig-ftp-passord-42'

let cleanup: () => Promise<void> = async () => {}
let server: SocketServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
  await cleanup()
})

async function setup(opts: { approve?: boolean; rate?: number } = {}) {
  const t = await makeTmpDir()
  cleanup = t.cleanup
  const dataDir = join(t.dir, 'data')
  const folder = join(t.dir, 'kafe.no')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'index.html'), '<html><head><title>A</title></head><body><h1>Hei</h1></body></html>')
  const s = createServices(dataDir)
  const site = await s.sites.create(
    { name: 'kafe.no', localPath: folder, host: '127.0.0.1', username: 'u', startingPoint: { choice: 'assume-synced', chosenAt: '', applied: false } },
    PASSWORD
  )
  const asked: string[] = []
  const api = new AgentApi({
    store: s.store,
    listSites: () => s.sites.store.list(),
    approve: async (name) => {
      asked.push(name)
      return opts.approve ?? true
    },
    logToSite: (id, msg) => s.logs.for(id).add('ai', msg),
    knownSecrets: async () => [PASSWORD],
    rateLimitPerMinute: opts.rate
  })
  registerReadMethods(api, { ...s })
  // Stand-ins for higher levels, so the gate can be tested before those methods exist.
  api.register('test_prepare', { level: 'prepare', needsSite: true, handler: async () => 'klargjort' })
  api.register('test_release', { level: 'release', needsSite: true, handler: async () => 'gitt ut' })
  api.register('test_leak', { level: 'read', needsSite: true, handler: async () => ({ text: `passordet er ${PASSWORD}`, nested: [PASSWORD] }) })
  return { s, site, api, asked, dataDir, folder, dir: t.dir }
}

const claude = { name: 'claude-code' }

describe('agent API gate', () => {
  it('refuses everything while the main switch is off (the default)', async () => {
    const { api, asked } = await setup()
    const r = await api.call(claude, 'skyv_list_sites')
    expect(r).toEqual({ ok: false, error: expect.objectContaining({ code: 'disabled' }) })
    expect(asked).toEqual([]) // not even asked
  })

  it('asks the user once for a new client, and remembers the answer', async () => {
    const { api, asked, s } = await setup()
    await s.store.setEnabled(true)
    expect((await api.call(claude, 'skyv_list_sites')).ok).toBe(true)
    expect((await api.call(claude, 'skyv_list_sites')).ok).toBe(true)
    expect(asked).toEqual(['Claude Code'])
    expect((await s.store.get()).clients).toEqual([expect.objectContaining({ id: 'claude-code', name: 'Claude Code', status: 'approved' })])
  })

  it('a denied client is refused, and stays refused until the user removes it', async () => {
    const { api, asked, s } = await setup({ approve: false })
    await s.store.setEnabled(true)
    expect(await api.call(claude, 'skyv_list_sites')).toEqual({ ok: false, error: expect.objectContaining({ code: 'denied' }) })
    expect(await api.call(claude, 'skyv_list_sites')).toEqual({ ok: false, error: expect.objectContaining({ code: 'denied' }) })
    expect(asked).toHaveLength(1)
    await s.store.removeClient('claude-code')
    await api.call(claude, 'skyv_list_sites')
    expect(asked).toHaveLength(2)
  })

  it('levels: "Bare se" can read but not prepare or release; "Se og klargjøre" cannot release', async () => {
    const { api, s, site } = await setup()
    await s.store.setEnabled(true)
    expect((await api.call(claude, 'skyv_get_status', { site: 'kafe.no' })).ok).toBe(true)
    expect(await api.call(claude, 'test_prepare', { site: 'kafe.no' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'forbidden' }) })
    expect(await api.call(claude, 'test_release', { site: site.id })).toEqual({ ok: false, error: expect.objectContaining({ code: 'forbidden' }) })
    await s.store.setLevel(site.id, 'prepare')
    expect(await api.call(claude, 'test_prepare', { site: 'kafe.no' })).toEqual({ ok: true, result: 'klargjort' })
    expect((await api.call(claude, 'test_release', { site: 'kafe.no' })).ok).toBe(false)
    await s.store.setLevel(site.id, 'release')
    expect(await api.call(claude, 'test_release', { site: 'KAFE.NO' })).toEqual({ ok: true, result: 'gitt ut' })
  })

  it('permissions cannot be changed through the API', async () => {
    const { api, s, site } = await setup()
    await s.store.setEnabled(true)
    for (const m of ['agent:setLevel', 'skyv_set_level', 'setLevel', 'agentSetEnabled', 'skyv_set_permission']) {
      expect((await api.call(claude, m, { site: 'kafe.no', level: 'release' })).ok).toBe(false)
    }
    expect(api.methodNames.some((n) => /level|permission|enable|ignore|approve|client/i.test(n))).toBe(false)
    expect(s.store.levelFor(await s.store.get(), site.id)).toBe('read')
  })

  it('unknown sites and bad parameters give clear messages', async () => {
    const { api, s } = await setup()
    await s.store.setEnabled(true)
    expect(await api.call(claude, 'skyv_get_status', { site: 'finnes-ikke.no' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'not-found' }) })
    expect(await api.call(claude, 'skyv_get_status', {})).toEqual({ ok: false, error: expect.objectContaining({ code: 'bad-request' }) })
  })

  it('limits the number of calls per minute', async () => {
    const { api, s } = await setup({ rate: 3 })
    await s.store.setEnabled(true)
    const results = []
    for (let i = 0; i < 5; i++) results.push((await api.call(claude, 'skyv_list_sites')).ok)
    expect(results).toEqual([true, true, true, false, false])
  })

  it('passwords never appear in replies, the site log or the list of recent actions', async () => {
    const { api, s, site, dataDir } = await setup()
    await s.store.setEnabled(true)
    const r = await api.call(claude, 'test_leak', { site: 'kafe.no' })
    expect(JSON.stringify(r)).not.toContain(PASSWORD)
    const status = await api.call(claude, 'skyv_get_status', { site: 'kafe.no' })
    expect(JSON.stringify(status)).not.toContain(PASSWORD)
    const logText = await readFile(join(dataDir, 'sites', site.id, 'log.jsonl'), 'utf8')
    expect(logText).toContain('Utført av AI (Claude Code): så på status')
    expect(logText).not.toContain(PASSWORD)
    // Search everything Skyv stored for the plain password.
    const walk = async (d: string): Promise<string[]> =>
      (await readdir(d, { withFileTypes: true })).flatMap((e) => [join(d, e.name)]).concat(
        ...(await Promise.all((await readdir(d, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => walk(join(d, e.name)))))
      )
    for (const f of await walk(dataDir)) {
      if ((await stat(f)).isFile()) expect([f, (await readFile(f)).toString('utf8').includes(PASSWORD)]).toEqual([f, false])
    }
  })

  it('status and site list describe the site in useful terms', async () => {
    const { api, s, folder } = await setup()
    await s.store.setEnabled(true)
    await api.call(claude, 'skyv_get_status', { site: 'kafe.no' }) // first scan sets the starting point
    await writeFile(join(folder, 'ny.html'), '<p>ny</p>')
    const list = await api.call(claude, 'skyv_list_sites')
    expect(list.ok && (list.result as { sites: unknown[] }).sites).toEqual([
      expect.objectContaining({ name: 'kafe.no', permission: 'Bare se', permission_level: 'read', ready: true })
    ])
    const st = await api.call(claude, 'skyv_get_status', { site: 'kafe.no' })
    expect(st.ok && (st.result as { changes: unknown }).changes).toEqual(expect.objectContaining({ total: 1, added: 1 }))
  })

  it('identifies clients and scrubs secrets deeply', () => {
    expect(identifyClient({ name: 'claude-code' })).toEqual({ id: 'claude-code', name: 'Claude Code' })
    expect(identifyClient({ name: 'Min agent' })).toEqual({ id: 'min-agent', name: 'Min agent' })
    expect(scrubSecrets({ a: ['x hemmelig1234 y'], b: 2 }, ['hemmelig1234'])).toEqual({ a: ['x •••• y'], b: 2 })
  })
})

describe('Unix socket', () => {
  it('serves the API with permissions 0600 and no network port', async () => {
    const { api, s, dir } = await setup()
    await s.store.setEnabled(true)
    const path = socketPathFor(join(dir, 'data'))
    server = await startSocketServer(path, (req) => api.call(req.client, req.method, req.params ?? {}))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(path)).isSocket()).toBe(true)
    const client = new SocketClient(path, claude)
    await client.connect()
    const [a, b] = await Promise.all([client.call('skyv_list_sites'), client.call('skyv_get_status', { site: 'kafe.no' })])
    expect(a.ok && b.ok).toBe(true)
    client.close()
  })

  it('replaces a stale socket file left by a crash', async () => {
    const { api, dir } = await setup()
    const path = socketPathFor(join(dir, 'data'))
    await writeFile(path, '')
    server = await startSocketServer(path, (req) => api.call(req.client, req.method, req.params ?? {}))
    expect((await stat(path)).isSocket()).toBe(true)
  })

  it('tells the client clearly when Skyv is not running', async () => {
    const { dir } = await setup()
    const client = new SocketClient(socketPathFor(join(dir, 'data')), claude)
    await expect(client.connect()).rejects.toBeInstanceOf(NotRunningError)
  })
})

describe('socket path', () => {
  it('uses the data folder normally, and a short private path when that is too long', () => {
    expect(socketPathFor('/Users/a/Library/Application Support/Skyv')).toBe('/Users/a/Library/Application Support/Skyv/skyv.sock')
    const long = '/Users/a/' + 'x'.repeat(120)
    const p = socketPathFor(long, '/Users/a')
    expect(p).toMatch(/^\/Users\/a\/\.skyv\/[0-9a-f]{12}\.sock$/)
    expect(Buffer.byteLength(p)).toBeLessThanOrEqual(104)
    expect(p).toBe(socketPathFor(long, '/Users/a'))
    expect(p).not.toBe(socketPathFor(long + 'y', '/Users/a'))
  })
})

describe('labels for the log', () => {
  it('every AI method has a plain Norwegian label', async () => {
    const { METHOD_LABEL } = await import('../src/core/agentApi/labels')
    const { ALL_TOOLS } = await import('../src/core/agentApi/toolDefs')
    for (const t of ALL_TOOLS) expect(METHOD_LABEL[t.name], t.name).toBeTruthy()
  })
})

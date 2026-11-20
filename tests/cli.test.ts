import { describe, it, expect, afterEach } from 'vitest'
import { writeFile, readFile, stat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runCli, parseArgs } from '../src/core/cli/cli'
import { SocketClient } from '../src/core/agentApi/socket'
import { setupInfo, cliScript, installCli, shellQuote } from '../src/core/agentApi/setup'
import { agentStack } from './helpers/agentStack'
import { makeTmpDir } from './helpers/tmp'

const KEY = 'sk-ant-' + 'api03-' + 'Xy7Zq9Wv2Ut5Sr8Qp1On4Ml7Kj0Ih3Gf'
let cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.reverse()) await c()
  cleanups = []
})

/** Run `skyv …` against the full stack, as the command line client. */
async function cliStack(level?: 'read' | 'prepare' | 'release') {
  const st = await agentStack({ level })
  cleanups.push(st.cleanup)
  const client = new SocketClient(st.socketPath, { name: 'skyv-kommandolinje' })
  await client.connect()
  cleanups.push(async () => client.close())
  const run = async (argv: string[], cwd = '/') => {
    const out: string[] = []
    const err: string[] = []
    const code = await runCli(argv, { call: (m, p) => client.call(m, p), cwd, out: (t) => out.push(t), err: (t) => err.push(t) })
    return { code, out: out.join('\n'), err: err.join('\n') }
  }
  return { ...st, run }
}

describe('skyv command line (same API and permissions as MCP)', () => {
  it('status for all sites, and for the site whose folder you are in', async () => {
    const { run, local } = await cliStack()
    await writeFile(join(local, 'ny.html'), '<p>ny</p>')
    const all = await run(['status'])
    expect(all.code).toBe(0)
    expect(all.out).toContain('kafe.no: 1 endringer (Bare se)')
    await mkdir(join(local, 'undermappe'), { recursive: true })
    const here = await run(['status'], join(local, 'undermappe'))
    expect(here.out).toContain('Endringer: 1 (1 nye')
    const json = await run(['status', 'kafe.no', '--json'])
    expect(JSON.parse(json.out).changes.added).toBe(1)
  })

  it('changes and check, with exit code 1 when a check stops the release', async () => {
    const { run, local } = await cliStack()
    await writeFile(join(local, 'app.js'), `const k = "${KEY}"\n`)
    const ch = await run(['changes', '--diff'], local)
    expect(ch.out).toContain('ny       app.js')
    expect(ch.out).toContain('[innhold skjult: mulig hemmelighet]')
    expect(ch.out).not.toContain(KEY)
    const check = await run(['check'], local)
    expect(check.code).toBe(1)
    expect(check.out).toMatch(/^STOPP: app\.js:1/m)
    expect(check.out).not.toContain(KEY)
  })

  it('"Bare se" refuses prepare; "Se og klargjøre" prepares but refuses release', async () => {
    const { run, local, s, site } = await cliStack('read')
    await writeFile(join(local, 'om.html'), '<p>ny</p>')
    const p1 = await run(['prepare', '-m', 'Ny tekst'], local)
    expect(p1.code).toBe(1)
    expect(p1.err).toContain('Bare se')
    await s.store.setLevel(site.id, 'prepare')
    const p2 = await run(['prepare', '-m', 'Ny tekst på Om oss'], local)
    expect(p2.code).toBe(0)
    expect(p2.out).toContain('Klar. Godkjenn og gi ut i Skyv.')
    const r = await run(['release'], local)
    expect(r.code).toBe(1)
    expect(r.err).toContain('Se og klargjøre')
  })

  it('with "Se, klargjøre og gi ut": prepare → release puts the files on the server', async () => {
    const { run, local, web } = await cliStack('release')
    await writeFile(join(local, 'om.html'), '<p>fra kommandolinjen</p>')
    expect((await run(['prepare', '-m', 'Ny tekst'], local)).code).toBe(0)
    const r = await run(['release'], local)
    expect(r.code).toBe(0)
    expect(r.out).toContain('Gitt ut: 1 filer')
    expect(await readFile(join(web, 'om.html'), 'utf8')).toBe('<p>fra kommandolinjen</p>')
    const h = await run(['history'], local)
    expect(h.out).toContain('success')
  })

  it('undo only sends a request to the user', async () => {
    const { run, local, web } = await cliStack('release')
    await writeFile(join(local, 'om.html'), '<p>ny</p>')
    await run(['prepare'], local)
    await run(['release'], local)
    const id = JSON.parse((await run(['history', '--json'], local)).out).releases[0].id
    const u = await run(['undo', id, '-m', 'Feil tekst'], local)
    expect(u.code).toBe(0)
    expect(u.out).toContain('Godkjenn den i Skyv')
    expect(await readFile(join(web, 'om.html'), 'utf8')).toBe('<p>ny</p>')
  })

  it('has no commands for permissions, ignoring findings or deleting', async () => {
    const { run } = await cliStack()
    for (const cmd of ['permission', 'level', 'ignore', 'delete', 'enable']) expect((await run([cmd])).code).toBe(2)
  })

  it('parses arguments', () => {
    expect(parseArgs(['prepare', 'kafe.no', '-m', 'notat', 'a.html', '--json'])).toEqual({ cmd: 'prepare', positional: ['kafe.no', 'a.html'], flags: { m: 'notat', json: true } })
  })
})

describe('setup for AI clients', () => {
  const dev = { runtime: '/Users/a/skyv/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', bridgeScript: '/Users/a/skyv/out/bridge/skyv-mcp.cjs', cliScript: '/Users/a/skyv/out/bridge/skyv.cjs' }
  const packaged = { ...dev, runtime: '/Applications/Skyv.app/Contents/MacOS/Skyv', bridgeLauncher: '/Applications/Skyv.app/Contents/Resources/bin/skyv-mcp' }

  it('installed app: a single launcher for both Claude Code and the Claude app', () => {
    const info = setupInfo(packaged, '/Users/a')
    expect(info.claudeCodeCommand).toBe('claude mcp add skyv -- /Applications/Skyv.app/Contents/Resources/bin/skyv-mcp')
    expect(JSON.parse(info.claudeDesktopJson)).toEqual({ mcpServers: { skyv: { command: '/Applications/Skyv.app/Contents/Resources/bin/skyv-mcp', args: [] } } })
    expect(info.claudeDesktopConfigPath).toBe('/Users/a/Library/Application Support/Claude/claude_desktop_config.json')
  })

  it('development: Electron as Node with the built bridge', () => {
    const info = setupInfo(dev, '/Users/a')
    expect(info.claudeCodeCommand).toBe(`claude mcp add skyv -e ELECTRON_RUN_AS_NODE=1 -- ${dev.runtime} ${dev.bridgeScript}`)
    expect(JSON.parse(info.claudeDesktopJson).mcpServers.skyv.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })

  it('quotes paths with spaces for the shell', () => {
    expect(shellQuote('/Users/a/Application Support/x')).toBe("'/Users/a/Application Support/x'")
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })

  it('installs skyv in ~/.local/bin without admin rights, updates it, and never replaces other files', async () => {
    const t = await makeTmpDir()
    cleanups.push(t.cleanup)
    const dir = join(t.dir, '.local', 'bin')
    const first = await installCli(dir, cliScript(packaged), `/usr/bin:${dir}`)
    expect(first).toEqual({ path: join(dir, 'skyv'), action: 'created', onPath: true })
    expect((await stat(first.path)).mode & 0o111).not.toBe(0)
    expect(await readFile(first.path, 'utf8')).toContain("ELECTRON_RUN_AS_NODE=1 exec /Applications/Skyv.app/Contents/MacOS/Skyv")
    expect((await installCli(dir, cliScript(packaged), '/usr/bin')).action).toBe('updated')
    expect((await installCli(dir, cliScript(packaged), '/usr/bin')).onPath).toBe(false)
    await writeFile(first.path, '#!/bin/sh\necho annen\n')
    await expect(installCli(dir, cliScript(packaged))).rejects.toThrow(/ikke laget av Skyv/)
  })
})

describe('cli flags', () => {
  it('accepts --note as the same as -m', async () => {
    const { parseArgs } = await import('../src/core/cli/cli')
    expect(parseArgs(['prepare', '--note', 'Ny tekst']).flags.m).toBe('Ny tekst')
  })
})

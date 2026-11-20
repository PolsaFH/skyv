import { describe, it, expect, afterEach } from 'vitest'
import { writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { agentStack } from './helpers/agentStack'
import { DraftStore } from '../src/core/agentApi/drafts'

const KEY = 'sk-ant-' + 'api03-' + 'Xy7Zq9Wv2Ut5Sr8Qp1On4Ml7Kj0Ih3Gf'

let cleanup: () => Promise<void> = async () => {}
afterEach(() => cleanup())

async function stack(level?: 'read' | 'prepare' | 'release') {
  const st = await agentStack({ level })
  cleanup = st.cleanup
  return st
}

describe('preparing and releasing through MCP (local FTP test server)', () => {
  it('level 3: status → prepare with note → release → the server is right, and the note is marked as AI', async () => {
    const { call, local, web, s, site, events } = await stack('release')
    await writeFile(join(local, 'index.html'), '<html><head><title>Kafé</title><link rel="stylesheet" href="stil.css"></head><body><h1>Velkommen til kafeen</h1><img src="logo.png" alt="Logo"></body></html>\n')
    await writeFile(join(local, 'logo.png'), 'PNG')
    await writeFile(join(local, 'utkast.html'), '<p>ikke valgt</p>')

    const status = await call('skyv_get_status')
    expect(status.data.changes.total).toBe(3)

    const prep = await call('skyv_prepare_release', { files: ['index.html'], note: 'Ny overskrift på forsiden og logo.' })
    expect(prep.isError).toBe(false)
    expect(prep.data.files.map((f: { path: string }) => f.path).sort()).toEqual(['index.html', 'logo.png']) // logo is needed by index.html
    expect(prep.data.files.find((f: { path: string }) => f.path === 'logo.png').included_because_needed_by).toEqual(['index.html'])
    expect(prep.data.ready_to_release).toBe(true)
    expect(events).toContainEqual({ type: 'drafts', siteId: site.id })
    expect((await call('skyv_get_status')).data.drafts).toHaveLength(1)

    const rel = await call('skyv_release_draft', { draft_id: prep.data.draft_id })
    expect(rel.data.released).toBe(true)
    expect(rel.data.release.status).toBe('success')
    expect(rel.data.health_check.ok).toBe(true)
    expect(await readFile(join(web, 'index.html'), 'utf8')).toContain('Velkommen til kafeen')
    expect(await readFile(join(web, 'logo.png'), 'utf8')).toBe('PNG')
    await expect(readFile(join(web, 'utkast.html'))).rejects.toThrow() // not in the draft

    const releases = await s.releases.list(site.id)
    expect(releases[0]).toEqual(expect.objectContaining({ note: 'Ny overskrift på forsiden og logo.', noteBy: 'Claude Code' }))
    expect((await new DraftStore(s.sites.store.siteDir(site.id)).get(prep.data.draft_id))?.status).toBe('released')
    // Releasing the same draft again is refused.
    const again = await call('skyv_release_draft', { draft_id: prep.data.draft_id })
    expect(again.data.released).toBe(false)
  })

  it('levels: "Bare se" cannot prepare; "Se og klargjøre" can prepare but not release', async () => {
    const { call, local, s, site } = await stack('read')
    await writeFile(join(local, 'om.html'), '<p>ny</p>')
    expect((await call('skyv_prepare_release')).isError).toBe(true)
    await s.store.setLevel(site.id, 'prepare')
    const prep = await call('skyv_prepare_release')
    expect(prep.isError).toBe(false)
    expect(prep.data.next_step).toContain('press "Gi ut" in Skyv')
    const rel = await call('skyv_release_draft', { draft_id: prep.data.draft_id })
    expect(rel.isError).toBe(true)
    expect(rel.text).toContain('Se og klargjøre')
  })

  it('refuses red findings, and never includes deletions', async () => {
    const { call, local } = await stack('release')
    await writeFile(join(local, 'app.js'), `const k = "${KEY}"\n`)
    await rm(join(local, 'om.html'))
    const prep = await call('skyv_prepare_release')
    expect(prep.data.files.map((f: { path: string }) => f.path)).toEqual(['app.js']) // deletion not included
    expect(prep.data.ready_to_release).toBe(false)
    expect(JSON.stringify(prep)).not.toContain(KEY)
    const rel = await call('skyv_release_draft', { draft_id: prep.data.draft_id })
    expect(rel.data.released).toBe(false)
    expect(rel.data.problems.join(' ')).toContain('alvorlig')
    const withDeletion = await call('skyv_prepare_release', { files: ['om.html'] })
    expect(withDeletion.isError).toBe(true)
    expect(withDeletion.text).toContain('Slettinger kan bare velges av brukeren')
  })

  it('refuses when the files changed after the draft was prepared', async () => {
    const { call, local, web } = await stack('release')
    await writeFile(join(local, 'om.html'), '<p>versjon 1</p>')
    const prep = await call('skyv_prepare_release')
    await writeFile(join(local, 'om.html'), '<p>versjon 2, endret etterpå</p>')
    const rel = await call('skyv_release_draft', { draft_id: prep.data.draft_id })
    expect(rel.data.released).toBe(false)
    expect(rel.data.problems).toContain('Filene har endret seg siden utkastet ble klargjort.')
    expect(await readFile(join(web, 'om.html'), 'utf8')).toContain('Om oss')
    // After updating the draft it can go out.
    await call('skyv_update_draft', { draft_id: prep.data.draft_id })
    expect((await call('skyv_release_draft', { draft_id: prep.data.draft_id })).data.released).toBe(true)
    expect(await readFile(join(web, 'om.html'), 'utf8')).toBe('<p>versjon 2, endret etterpå</p>')
  })

  it('refuses conflicts on the server and unhandled server deviations', async () => {
    const { call, local, web, s, site } = await stack('release')
    await writeFile(join(local, 'om.html'), '<p>min</p>')
    await writeFile(join(web, 'om.html'), '<p>endret av noen andre på serveren, lengre</p>')
    const prep = await call('skyv_prepare_release')
    const rel = await call('skyv_release_draft', { draft_id: prep.data.draft_id })
    expect(rel.data.released).toBe(false)
    expect(rel.data.problems.join(' ')).toContain('endret på serveren')

    // Deviation found by the server check (file missing on the server) also stops it.
    await writeFile(join(web, 'om.html'), BASE_OM)
    await rm(join(web, 'stil.css'))
    await writeFile(join(local, 'stil.css'), 'body{color:red}\n')
    await s.serverCheck.run(site.id)
    const prep2 = await call('skyv_prepare_release', { files: ['stil.css'] })
    const rel2 = await call('skyv_release_draft', { draft_id: prep2.data.draft_id })
    expect(rel2.data.released).toBe(false)
    expect(rel2.data.problems.join(' ')).toContain('avvik')
  })

  it('refuses drafts older than 24 hours', async () => {
    const { call, local, dataDir, site } = await stack('release')
    await writeFile(join(local, 'om.html'), '<p>gammel</p>')
    const prep = await call('skyv_prepare_release')
    const file = join(dataDir, 'sites', site.id, 'drafts.json')
    const d = JSON.parse(await readFile(file, 'utf8'))
    d.drafts[0].createdAt = new Date(Date.now() - 25 * 3600_000).toISOString()
    await writeFile(file, JSON.stringify(d))
    const rel = await call('skyv_release_draft', { draft_id: prep.data.draft_id })
    expect(rel.data.problems).toContain('Utkastet er eldre enn 24 timer.')
  })

  it('the AI can only ask for undo; the release stays until the user approves', async () => {
    const { call, local, web, events, mcp } = await stack('release')
    await writeFile(join(local, 'om.html'), '<p>ny</p>')
    const prep = await call('skyv_prepare_release')
    const rel = await call('skyv_release_draft', { draft_id: prep.data.draft_id })
    const req = await call('skyv_request_undo', { release_id: rel.data.release.id, reason: 'Siden ser feil ut på mobil.' })
    expect(req.data.status).toBe('waiting_for_user')
    expect(events.some((e) => e.type === 'undo')).toBe(true)
    expect(await readFile(join(web, 'om.html'), 'utf8')).toBe('<p>ny</p>')
    expect((await call('skyv_get_status')).data.undo_requests_waiting_for_user).toBe(1)
    const tools = (await mcp.listTools()).tools.map((t) => t.name)
    expect(tools.filter((n) => /undo/.test(n))).toEqual(['skyv_request_undo'])
  })

  it('notes set by AI on earlier releases are marked', async () => {
    const { call, local, s, site } = await stack('release')
    await writeFile(join(local, 'om.html'), '<p>ny</p>')
    const prep = await call('skyv_prepare_release')
    const rel = await call('skyv_release_draft', { draft_id: prep.data.draft_id })
    await call('skyv_set_release_note', { release_id: rel.data.release.id, note: 'Ny tekst på Om oss.' })
    expect((await s.releases.list(site.id))[0]).toEqual(expect.objectContaining({ note: 'Ny tekst på Om oss.', noteBy: 'Claude Code' }))
  })
})

const BASE_OM = '<html><head><title>Om</title></head><body><h1>Om oss</h1></body></html>\n'

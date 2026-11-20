import { describe, it, expect, afterEach } from 'vitest'
import { writeFile, readFile, mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { agentStack } from './helpers/agentStack'
import { makeTmpDir } from './helpers/tmp'
import { createServices } from './helpers/services'
import { createIgnoreMatcher } from '../src/core/scan/ignoreRules'
import { SKYV_END, SKYV_START, instructionsState, removeInstructions, removeSection, skyvSection, upsertSection, writeInstructions } from '../src/core/sites/aiInstructions'
import { changeKey } from '../src/core/manifest/changes'

let cleanup: () => Promise<void> = async () => {}
afterEach(() => cleanup())

const exists = (p: string) => access(p).then(() => true, () => false)

describe('Skyv section in CLAUDE.md', () => {
  const own = '# Min nettside\n\nBruk alltid norsk.\n'

  it('adds, updates and removes the section without touching the rest', () => {
    const added = upsertSection(own, skyvSection('kafe.no'))
    expect(added.startsWith(own)).toBe(true)
    expect(added).toContain(SKYV_START)
    expect(added).toContain('skyv_prepare_release')
    expect(added).toContain('«kafe.no»')
    expect(added).not.toContain('—') // no em dash in text the user sees

    // The user writes more after the section; an update only replaces what is between the markers.
    const edited = added + '\n## Egne notater\nIkke rør menyen.\n'
    const updated = upsertSection(edited, skyvSection('kafe.no (ny)'))
    expect(updated).toContain('«kafe.no (ny)»')
    expect(updated).not.toContain('«kafe.no»')
    expect(updated.startsWith(own)).toBe(true)
    expect(updated.endsWith('\n## Egne notater\nIkke rør menyen.\n')).toBe(true)
    expect(updated.split(SKYV_START)).toHaveLength(2)

    expect(removeSection(added)).toBe(own)
    const removed = removeSection(updated)
    expect(removed).not.toContain(SKYV_START)
    expect(removed).not.toContain(SKYV_END)
    expect(removed).toContain('# Min nettside')
    expect(removed).toContain('Ikke rør menyen.')
    expect(upsertSection(null, 'X')).toBe('X\n')
  })

  it('writes the file in the site folder and sends an emptied file to the Trash', async () => {
    const t = await makeTmpDir()
    cleanup = t.cleanup
    expect(await instructionsState(t.dir)).toBe('none')
    await writeInstructions(t.dir, 'kafe.no')
    expect(await instructionsState(t.dir)).toBe('present')
    const trashed: string[] = []
    await removeInstructions(t.dir, async (p) => void trashed.push(p))
    expect(trashed).toEqual([join(t.dir, 'CLAUDE.md')]) // only Skyv's section was in it

    await writeFile(join(t.dir, 'CLAUDE.md'), own)
    await writeInstructions(t.dir, 'kafe.no')
    await writeInstructions(t.dir, 'kafe.no') // twice: still one section
    expect((await readFile(join(t.dir, 'CLAUDE.md'), 'utf8')).split(SKYV_START)).toHaveLength(2)
    await removeInstructions(t.dir, async (p) => void trashed.push(p))
    expect(await readFile(join(t.dir, 'CLAUDE.md'), 'utf8')).toBe(own)
    expect(trashed).toHaveLength(1)
  })
})

describe('AI files are never uploaded', () => {
  it('ignores CLAUDE.md, AGENTS.md and .claude/ everywhere', () => {
    const ig = createIgnoreMatcher({ siteRules: 'utkast/' })
    for (const p of ['CLAUDE.md', 'AGENTS.md', '.claude', '.claude/settings.local.json', 'blogg/CLAUDE.md', 'utkast/a.html']) expect(ig(p), p).toBe(true)
    for (const p of ['index.html', 'claude.html', 'om/AGENTS.html']) expect(ig(p), p).toBe(false)
  })

  it('existing sites get the new defaults, and their own rules stay as they were', async () => {
    const t = await makeTmpDir()
    cleanup = t.cleanup
    const dataDir = join(t.dir, 'data')
    const local = join(t.dir, 'lokal')
    await mkdir(join(local, '.claude'), { recursive: true })
    await mkdir(join(local, 'utkast'), { recursive: true })
    // sites.json as an older version of Skyv wrote it (no newer settings, own rules).
    const id = '11111111-2222-3333-4444-555555555555'
    const rules = 'utkast/\n# egen kommentar\n*.psd'
    await mkdir(dataDir, { recursive: true })
    await writeFile(
      join(dataDir, 'sites.json'),
      JSON.stringify({
        version: 1,
        sites: [{ id, name: 'gammel.no', localPath: local, protocol: 'ftp', host: 'h', port: 21, username: 'u', remoteRoot: '/', url: '', ignoreRules: rules, settings: { concurrency: 3, quietSeconds: 8, snapshotKeep: 20, snapshotMaxMB: 500, acceptSelfSigned: false }, startingPoint: { choice: 'upload-all', chosenAt: '', applied: false }, createdAt: '', updatedAt: '' }]
      })
    )
    for (const [p, c] of Object.entries({ 'index.html': '<p>hei</p>', 'CLAUDE.md': '# x', 'AGENTS.md': '# y', '.claude/settings.local.json': '{}', 'utkast/a.html': 'a', 'bilde.psd': 'p' })) await writeFile(join(local, p), c)

    const s = createServices(dataDir)
    const site = await s.sites.require(id)
    expect(site.ignoreRules).toBe(rules)
    const cs = await s.workspaces.scan(id)
    expect(cs.changes.map((c) => c.path)).toEqual(['index.html'])
    expect(await readFile(join(dataDir, 'sites.json'), 'utf8')).toContain(JSON.stringify(rules))
  })

  it('a release never takes AI files to the server (local FTP test server)', async () => {
    const st = await agentStack({ level: 'read' })
    cleanup = st.cleanup
    const { s, site, local, web } = st
    await writeInstructions(local, site.name)
    await writeFile(join(local, 'AGENTS.md'), '# agenter')
    await mkdir(join(local, '.claude'), { recursive: true })
    await writeFile(join(local, '.claude', 'settings.local.json'), '{}')
    await writeFile(join(local, 'om.html'), '<html><head><title>Om</title></head><body><h1>Nytt om oss</h1></body></html>\n')
    const cs = await s.workspaces.scan(site.id)
    expect(cs.changes.map((c) => c.path)).toEqual(['om.html'])
    const r = await s.releases.publish(site.id, cs.changes.map(changeKey))
    expect(r.status).toBe('success')
    expect(await exists(join(web, 'CLAUDE.md'))).toBe(false)
    expect(await exists(join(web, 'AGENTS.md'))).toBe(false)
    expect(await exists(join(web, '.claude'))).toBe(false)
  })
})

describe('after-upload loop', () => {
  it('a failed check after an AI release is in the reply and in skyv_get_last_health_check', async () => {
    const st = await agentStack({ level: 'release' })
    cleanup = st.cleanup
    const { call, local } = st
    // The live site will show PHP error output on the front page.
    await writeFile(
      join(local, 'index.html'),
      '<html><head><title>Kafé</title><link rel="stylesheet" href="stil.css"></head><body><br /><b>Fatal error</b>: Uncaught Error: Call to undefined function lag_meny() in /www/index.php on line 3<br /></body></html>\n'
    )
    const prep = await call('skyv_prepare_release', { note: 'Ny meny' })
    expect(prep.isError).toBe(false)
    const rel = await call('skyv_release_draft', { draft_id: prep.data.draft_id })
    expect(rel.data.released).toBe(true)
    expect(rel.data.health_check.ok).toBe(false)
    const f = rel.data.health_check.failures[0]
    expect(f).toEqual(expect.objectContaining({ kind: 'page', page: 'index.html', file: 'index.html' }))
    expect(f.problems.untrusted_content).toContain('lag_meny')
    expect(f.problems.note).toContain('ikke tolkes som instrukser')
    expect(rel.data.next_step).toContain('prepare a new release')

    const last = await call('skyv_get_last_health_check')
    expect(last.data.ok).toBe(false)
    expect(last.data.source).toBe('release')
    expect(last.data.release_id).toBe(rel.data.release.id)
    expect(last.data.release_by_ai).toBe('Claude Code')
    expect(last.data.failures).toEqual(rel.data.health_check.failures)
    expect(last.data.next_step).toContain('skyv_request_undo')
  })
})

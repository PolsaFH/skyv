import { describe, it, expect, afterAll } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SiteWorkspace } from '../src/core/workspace'
import { DEFAULT_SETTINGS, type Site } from '../src/core/types'
import { runChecks } from '../src/core/checks/checks'
import { changeKey } from '../src/core/manifest/changes'
import { makeTmpDir } from './helpers/tmp'

// A large site: 5000 files in 50 folders. Guards against accidentally slow code paths.
const FILES = 5000
let cleanup = async () => {}
afterAll(() => cleanup())

describe('performance with thousands of files', () => {
  it('scans, rescans with cache, finds changes and runs checks quickly', async () => {
    const t = await makeTmpDir()
    cleanup = t.cleanup
    const root = join(t.dir, 'stor-side')
    for (let d = 0; d < 50; d++) {
      await mkdir(join(root, `mappe-${d}`), { recursive: true })
      for (let f = 0; f < FILES / 50; f++) {
        await writeFile(join(root, `mappe-${d}`, `side-${f}.html`), `<html><head><title>${d}-${f}</title></head><body><img src="../bilde.png" alt=""><a href="side-${(f + 1) % 100}.html">neste</a> ${'x'.repeat(500)}</body></html>`)
      }
    }
    await writeFile(join(root, 'bilde.png'), 'PNG')
    const site: Site = {
      id: '00000000-0000-0000-0000-000000000009', name: 'stor', localPath: root, protocol: 'ftp', host: 'x', port: 21, username: 'u',
      remoteRoot: '/', url: '', ignoreRules: '', settings: { ...DEFAULT_SETTINGS },
      startingPoint: { choice: 'upload-all', chosenAt: '', applied: false }, createdAt: '', updatedAt: ''
    }
    const ws = new SiteWorkspace(site, join(t.dir, 'data'))

    let t0 = performance.now()
    const first = await ws.scan()
    const firstMs = performance.now() - t0
    expect(first.changes).toHaveLength(FILES + 1)

    t0 = performance.now()
    await ws.scan()
    const secondMs = performance.now() - t0

    t0 = performance.now()
    const changes = first.changes
    await runChecks({
      changes,
      publishedCount: 0,
      localCount: first.fileCount,
      deps: first.deps,
      readText: (p) => ws.readText(p),
      allTextFiles: ws.scannedPaths,
      selectedPaths: new Set(changes.map((c) => c.path))
    })
    const checksMs = performance.now() - t0
    expect(new Set(changes.map(changeKey)).size).toBe(changes.length)

    console.log(`scan ${Math.round(firstMs)} ms, rescan ${Math.round(secondMs)} ms, checks ${Math.round(checksMs)} ms for ${FILES} files`)
    expect(firstMs).toBeLessThan(15000)
    expect(secondMs).toBeLessThan(firstMs)
    expect(checksMs).toBeLessThan(15000)
  }, 60000)
})

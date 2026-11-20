import { describe, it, expect } from 'vitest'
import { analyzeDependencies } from '../src/core/deps/dependencies'
import { emptyManifest } from '../src/core/manifest/manifest'
import { createIgnoreMatcher } from '../src/core/scan/ignoreRules'
import type { Change } from '../src/core/manifest/changes'
import type { ScannedFile } from '../src/core/scan/scanner'

function setup(contents: Record<string, string>, published: string[], ignoredOnDisk: string[] = []) {
  const files = new Map<string, ScannedFile>()
  for (const p of Object.keys(contents)) files.set(p, { path: p, size: contents[p].length, mtimeMs: 1, hash: 'h' + p })
  const manifest = emptyManifest()
  for (const p of published) manifest.files[p] = { hash: 'h' + p, size: 1, localMtimeMs: 1, publishedAt: '' }
  return {
    files,
    manifest,
    ignore: createIgnoreMatcher({ siteRules: 'utkast/' }),
    readText: async (p: string) => contents[p] ?? null,
    existsOnDisk: async (p: string) => p in contents || ignoredOnDisk.includes(p)
  }
}
const change = (path: string, kind: Change['kind'] = 'modified'): Change => ({ path, kind, size: 1 })

describe('dependency analysis', () => {
  it('finds new files a changed page needs, also through its CSS', async () => {
    const s = setup(
      {
        'index.html': '<link href="css/ny.css" rel="stylesheet"><img src="bilder/hero.jpg"><img src="logo.png">',
        'css/ny.css': 'body{background:url(../bilder/bg.jpg)}',
        'bilder/hero.jpg': 'x',
        'bilder/bg.jpg': 'x',
        'logo.png': 'x'
      },
      ['index.html', 'logo.png']
    )
    const info = await analyzeDependencies({ ...s, changes: [change('index.html')] })
    expect(info.neededBy).toEqual({
      'css/ny.css': ['index.html'],
      'bilder/hero.jpg': ['index.html'],
      'bilder/bg.jpg': ['css/ny.css']
    })
    expect(info.missing).toEqual([])
  })

  it('warns about references to files that do not exist', async () => {
    const s = setup({ 'index.html': '<p>\n<img src="bilder/mangler.png"></p>' }, ['index.html'])
    const info = await analyzeDependencies({ ...s, changes: [change('index.html')] })
    expect(info.missing).toEqual([{ from: 'index.html', line: 2, ref: 'bilder/mangler.png', path: 'bilder/mangler.png' }])
  })

  it('warns when only upper/lower case differs (breaks on the web server)', async () => {
    const s = setup({ 'index.html': '<img src="Bilder/Logo.PNG">', 'bilder/logo.png': 'x' }, ['index.html', 'bilder/logo.png'])
    const info = await analyzeDependencies({ ...s, changes: [change('index.html')] })
    expect(info.caseMismatch).toEqual([expect.objectContaining({ path: 'Bilder/Logo.PNG', actual: 'bilder/logo.png' })])
  })

  it('warns when a needed file is on the ignore list', async () => {
    const s = setup({ 'index.html': '<img src="utkast/bilde.png">' }, ['index.html'], ['utkast/bilde.png'])
    const info = await analyzeDependencies({ ...s, changes: [change('index.html')] })
    expect(info.ignored).toEqual([expect.objectContaining({ path: 'utkast/bilde.png' })])
  })

  it('follows PHP includes and folder links to index files', async () => {
    const s = setup(
      { 'index.php': "<?php include 'inc/meny.php'; ?><a href=\"om-oss/\">Om</a><a href=\"kontakt\">K</a>", 'inc/meny.php': '<nav></nav>', 'om-oss/index.html': 'x' },
      ['index.php']
    )
    const info = await analyzeDependencies({ ...s, changes: [change('index.php')] })
    expect(Object.keys(info.neededBy).sort()).toEqual(['inc/meny.php', 'om-oss/index.html'])
    expect(info.missing).toEqual([]) // "kontakt" without extension is a pretty URL
  })

  it('ignores deleted files and external links', async () => {
    const s = setup({ 'a.html': '<a href="https://x.no/y.png">' }, ['a.html'])
    const info = await analyzeDependencies({ ...s, changes: [change('a.html'), change('borte.html', 'deleted')] })
    expect(info).toEqual({ neededBy: {}, missing: [], caseMismatch: [], ignored: [] })
  })
})

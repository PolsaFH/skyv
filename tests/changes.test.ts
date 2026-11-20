import { describe, it, expect } from 'vitest'
import { detectChanges, selectedByDefault } from '../src/core/manifest/changes'
import { emptyManifest, type Manifest } from '../src/core/manifest/manifest'
import type { ScannedFile } from '../src/core/scan/scanner'
import { createIgnoreMatcher } from '../src/core/scan/ignoreRules'

const h = (c: string) => c.repeat(64).slice(0, 64)
const file = (path: string, hash: string, size = 10): ScannedFile => ({ path, hash, size, mtimeMs: 1 })
const scan = (...files: ScannedFile[]) => new Map(files.map((f) => [f.path, f]))
function manifest(entries: Record<string, string>): Manifest {
  const m = emptyManifest()
  for (const [p, hash] of Object.entries(entries)) m.files[p] = { hash, size: 10, localMtimeMs: 1, publishedAt: '2026-01-01' }
  return m
}

describe('change detection', () => {
  it('finds added, modified and deleted files', () => {
    const changes = detectChanges(
      scan(file('index.html', h('a')), file('css/stil.css', h('c')), file('ny.html', h('n'))),
      manifest({ 'index.html': h('a'), 'css/stil.css': h('b'), 'gammel.html': h('g') })
    )
    expect(changes.map((c) => [c.path, c.kind])).toEqual([
      ['css/stil.css', 'modified'],
      ['gammel.html', 'deleted'],
      ['ny.html', 'added']
    ])
  })

  it('reports nothing when everything matches', () => {
    expect(detectChanges(scan(file('a.html', h('a'))), manifest({ 'a.html': h('a') }))).toEqual([])
  })

  it('detects renames by identical content', () => {
    const changes = detectChanges(scan(file('bilder/ny-logo.png', h('l'))), manifest({ 'logo.png': h('l') }))
    expect(changes).toEqual([expect.objectContaining({ kind: 'renamed', from: 'logo.png', path: 'bilder/ny-logo.png' })])
  })

  it('detects case-only renames', () => {
    const changes = detectChanges(scan(file('index.html', h('i'))), manifest({ 'Index.html': h('i') }))
    expect(changes).toEqual([expect.objectContaining({ kind: 'renamed', from: 'Index.html', path: 'index.html' })])
  })

  it('pairs duplicates sensibly when several files share content', () => {
    const changes = detectChanges(
      scan(file('a/tom.txt', h('e')), file('b/tom.txt', h('e'))),
      manifest({ 'b/gammel.txt': h('e') })
    )
    const renamed = changes.find((c) => c.kind === 'renamed')!
    expect(renamed.from).toBe('b/gammel.txt')
    expect(renamed.path).toBe('b/tom.txt')
    expect(changes.find((c) => c.kind === 'added')!.path).toBe('a/tom.txt')
  })

  it('never reports ignored files as deleted', () => {
    const changes = detectChanges(scan(), manifest({ 'app.js.map': h('m'), 'side.html': h('s') }), createIgnoreMatcher({ ignoreSourceMaps: true }))
    expect(changes.map((c) => c.path)).toEqual(['side.html'])
  })

  it('selects everything but deletions by default', () => {
    expect(selectedByDefault({ path: 'x', kind: 'deleted', size: 1 })).toBe(false)
    expect(selectedByDefault({ path: 'x', kind: 'added', size: 1 })).toBe(true)
    expect(selectedByDefault({ path: 'x', kind: 'renamed', size: 1 })).toBe(true)
  })

  it('treats everything as added with an empty manifest (upload everything)', () => {
    const changes = detectChanges(scan(file('a', h('a')), file('b', h('b'))), emptyManifest())
    expect(changes.every((c) => c.kind === 'added')).toBe(true)
  })
})

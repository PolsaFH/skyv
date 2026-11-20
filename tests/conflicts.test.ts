import { describe, it, expect } from 'vitest'
import { findConflicts } from '../src/core/release/conflicts'
import { emptyManifest } from '../src/core/manifest/manifest'
import type { RemoteEntry } from '../src/core/remote/types'
import type { Change } from '../src/core/manifest/changes'

const lister = (tree: Record<string, RemoteEntry[]>) => ({
  async list(path: string) {
    if (!(path in tree)) throw new Error('550')
    return tree[path]
  }
})
const file = (name: string, size: number, modifiedAt?: number): RemoteEntry => ({ name, type: 'file', size, modifiedAt })
const ch = (path: string, kind: Change['kind'], from?: string): Change => ({ path, kind, size: 1, from })

function manifest(entries: Record<string, { size: number; remoteSize?: number; remoteMtimeMs?: number }>) {
  const m = emptyManifest()
  for (const [p, e] of Object.entries(entries)) m.files[p] = { hash: 'h', localMtimeMs: 1, publishedAt: '', ...e }
  return m
}

describe('overwrite protection', () => {
  it('finds files changed on the server since the last release (size or time)', async () => {
    const m = manifest({
      'index.html': { size: 10, remoteSize: 10, remoteMtimeMs: 1_000_000 },
      'om.html': { size: 5, remoteSize: 5, remoteMtimeMs: 1_000_000 },
      'kontakt.html': { size: 7, remoteSize: 7, remoteMtimeMs: 1_000_000 }
    })
    const server = lister({ '/www': [file('index.html', 12, 1_000_000), file('om.html', 5, 9_000_000), file('kontakt.html', 7, 1_000_500)] })
    const res = await findConflicts([ch('index.html', 'modified'), ch('om.html', 'deleted'), ch('kontakt.html', 'modified')], m, server, '/www')
    expect(res.map((c) => `${c.reason}:${c.path}`)).toEqual(['changed-on-server:index.html', 'changed-on-server:om.html'])
  })

  it('uses the size from the starting point when the server time is unknown', async () => {
    const m = manifest({ 'a.html': { size: 10 } })
    expect(await findConflicts([ch('a.html', 'modified')], m, lister({ '/': [file('a.html', 10)] }), '/')).toEqual([])
    expect(await findConflicts([ch('a.html', 'modified')], m, lister({ '/': [file('a.html', 11)] }), '/')).toHaveLength(1)
  })

  it('warns when a new file would replace one someone else put on the server', async () => {
    const m = manifest({ 'index.html': { size: 1 } })
    const res = await findConflicts([ch('bilder/ny.png', 'added')], m, lister({ '/bilder': [file('ny.png', 3)] }), '/')
    expect(res).toEqual([expect.objectContaining({ path: 'bilder/ny.png', reason: 'exists-on-server' })])
  })

  it('does not warn on the first full upload, or when the folder does not exist yet', async () => {
    expect(await findConflicts([ch('index.html', 'added')], emptyManifest(), lister({ '/': [file('index.html', 3)] }), '/')).toEqual([])
    expect(await findConflicts([ch('ny/side.html', 'added')], manifest({ x: { size: 1 } }), lister({}), '/')).toEqual([])
  })

  it('checks both the old and new path of a rename', async () => {
    const m = manifest({ 'gammel.png': { size: 4, remoteSize: 4 } })
    const res = await findConflicts([ch('ny.png', 'renamed', 'gammel.png')], m, lister({ '/': [file('gammel.png', 9)] }), '/')
    expect(res.map((c) => c.path)).toEqual(['gammel.png'])
  })
})

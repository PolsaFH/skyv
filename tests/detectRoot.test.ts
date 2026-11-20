import { describe, it, expect } from 'vitest'
import { detectRemoteRoot, scoreCandidate } from '../src/core/remote/detectRoot'
import type { RemoteEntry, RemoteLister } from '../src/core/remote/types'

const f = (name: string): RemoteEntry => ({ name, type: 'file', size: 1 })
const d = (name: string): RemoteEntry => ({ name, type: 'dir', size: 0 })

function fakeServer(tree: Record<string, RemoteEntry[]>): RemoteLister & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async list(path: string) {
      calls.push(path)
      if (!(path in tree)) throw new Error('550 not found')
      return tree[path]
    }
  }
}

const local = { files: ['index.html', 'kontakt.html', 'favicon.ico'], dirs: ['css', 'bilder'] }

describe('scoreCandidate', () => {
  it('scores a matching folder higher than a non-matching one', () => {
    const good = scoreCandidate('/public_html', [f('index.html'), f('kontakt.html'), d('css')], local)
    const bad = scoreCandidate('/', [d('logs'), d('public_html'), f('.bashrc')], local)
    expect(good.score).toBeGreaterThan(bad.score)
    expect(good.matched).toContain('index.html')
  })
  it('matches case-insensitively and with Norwegian characters', () => {
    const c = scoreCandidate('/x', [f('Index.HTML'), d('Bilder')], { files: ['index.html'], dirs: ['bilder'] })
    expect(c.matched).toHaveLength(2)
  })
  it('prefers an empty common web root for a brand new site', () => {
    const empty = scoreCandidate('/public_html', [], local)
    const other = scoreCandidate('/', [d('logs'), d('public_html')], local)
    expect(empty.score).toBeGreaterThan(other.score)
  })
})

describe('detectRemoteRoot', () => {
  it('finds public_html under the home folder', async () => {
    const server = fakeServer({
      '/': [d('logs'), d('public_html'), d('tmp'), f('.profile')],
      '/public_html': [f('index.html'), f('kontakt.html'), d('css'), d('bilder')]
    })
    const res = await detectRemoteRoot(server, local, { startDir: '/' })
    expect(res[0].path).toBe('/public_html')
    expect(server.calls).not.toContain('/logs')
  })

  it('looks inside domains/<site name>/public_html', async () => {
    const server = fakeServer({
      '/': [d('domains')],
      '/domains': [d('minside.no'), d('annen.no')],
      '/domains/minside.no': [d('public_html'), d('logs')],
      '/domains/minside.no/public_html': [f('index.html'), d('css')]
    })
    const res = await detectRemoteRoot(server, local, { startDir: '/', siteName: 'minside.no' })
    expect(res[0].path).toBe('/domains/minside.no/public_html')
    expect(server.calls).not.toContain('/domains/annen.no')
  })

  it('suggests the home folder itself when files are already there', async () => {
    const server = fakeServer({ '/': [f('index.html'), f('kontakt.html'), d('css'), d('bilder')] })
    const res = await detectRemoteRoot(server, local, { startDir: '/' })
    expect(res[0].path).toBe('/')
  })

  it('survives folders that cannot be listed and respects the listing limit', async () => {
    const server = fakeServer({ '/': [d('www'), d('htdocs'), d('web')] })
    const res = await detectRemoteRoot(server, local, { startDir: '/', maxListings: 2 })
    expect(server.calls.length).toBeLessThanOrEqual(2)
    expect(res.length).toBeGreaterThanOrEqual(1)
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionTracker, SessionStore, type WorkSession } from '../src/core/watch/sessions'
import { SiteWatcher } from '../src/core/watch/siteWatcher'
import { createIgnoreMatcher } from '../src/core/scan/ignoreRules'
import { makeTmpDir } from './helpers/tmp'

/** Manual clock and timers. */
function fakeTime() {
  let now = 1_000_000
  const timers = new Map<number, { at: number; fn: () => void }>()
  let next = 1
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const id = next++
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimer: (id: unknown) => timers.delete(id as number),
    advance(ms: number) {
      now += ms
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id)
          t.fn()
        }
      }
    }
  }
}

describe('session tracker', () => {
  it('groups a burst of edits into one session after the quiet period', () => {
    const t = fakeTime()
    const sessions: WorkSession[] = []
    const tracker = new SessionTracker({ quietMs: 8000, onSession: (s) => sessions.push(s), ...t })
    tracker.touch('index.html')
    t.advance(3000)
    tracker.touch('css/stil.css')
    t.advance(5000)
    tracker.touch('index.html')
    t.advance(7999)
    expect(sessions).toHaveLength(0)
    t.advance(1)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].paths).toEqual(['css/stil.css', 'index.html'])
    expect(Date.parse(sessions[0].endedAt) - Date.parse(sessions[0].startedAt)).toBe(16000)
  })

  it('starts a new session after a quiet period', () => {
    const t = fakeTime()
    const sessions: WorkSession[] = []
    const tracker = new SessionTracker({ quietMs: 1000, onSession: (s) => sessions.push(s), ...t })
    tracker.touch('a.html')
    t.advance(1000)
    tracker.touch('b.html')
    t.advance(1000)
    expect(sessions.map((s) => s.paths)).toEqual([['a.html'], ['b.html']])
  })

  it('stop() discards a session in progress', () => {
    const t = fakeTime()
    const sessions: WorkSession[] = []
    const tracker = new SessionTracker({ quietMs: 1000, onSession: (s) => sessions.push(s), ...t })
    tracker.touch('a.html')
    tracker.stop()
    t.advance(5000)
    expect(sessions).toEqual([])
  })
})

describe('session store', () => {
  let cleanup = async () => {}
  afterEach(() => cleanup())
  it('remembers the latest session per file and keeps a limited number', async () => {
    const tmp = await makeTmpDir()
    cleanup = tmp.cleanup
    const store = new SessionStore(tmp.dir, 2)
    const s = (id: string, paths: string[]): WorkSession => ({ id, startedAt: '', endedAt: '', paths })
    await store.add(s('1', ['a.html', 'b.html']))
    await store.add(s('2', ['b.html']))
    await store.add(s('3', ['c.html']))
    const map = await store.byPath()
    expect(map.get('b.html')?.id).toBe('2')
    expect(map.has('a.html')).toBe(false) // session 1 dropped
    expect(map.get('c.html')?.id).toBe('3')
  })
})

describe('site watcher (real folder)', () => {
  let cleanup = async () => {}
  let watcher: SiteWatcher | null = null
  afterEach(async () => {
    await watcher?.stop()
    await cleanup()
  })

  it('reports changed files and never ignored ones', async () => {
    const tmp = await makeTmpDir()
    cleanup = tmp.cleanup
    await mkdir(join(tmp.dir, 'css'))
    await mkdir(join(tmp.dir, 'node_modules', 'x'), { recursive: true })
    await writeFile(join(tmp.dir, 'index.html'), 'a')
    const seen = new Set<string>()
    watcher = new SiteWatcher({ root: tmp.dir, ignore: createIgnoreMatcher(), onPath: (p) => seen.add(p) })
    await watcher.start()

    await writeFile(join(tmp.dir, 'index.html'), 'b')
    await writeFile(join(tmp.dir, 'css', 'ny æøå.css'), 'x')
    await writeFile(join(tmp.dir, '.DS_Store'), 'x')
    await writeFile(join(tmp.dir, 'node_modules', 'x', 'y.js'), 'x')
    await writeFile(join(tmp.dir, 'feil.log'), 'x')
    await rm(join(tmp.dir, 'index.html'))

    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !(seen.has('index.html') && seen.has('css/ny æøå.css'))) await new Promise((r) => setTimeout(r, 50))
    await new Promise((r) => setTimeout(r, 300))
    expect([...seen].sort()).toEqual(['css/ny æøå.css', 'index.html'])
  })
})

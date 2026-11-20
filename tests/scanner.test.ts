import { describe, it, expect, afterEach } from 'vitest'
import { mkdir, writeFile, symlink, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { scanFolder } from '../src/core/scan/scanner'
import { createIgnoreMatcher } from '../src/core/scan/ignoreRules'
import { makeTmpDir } from './helpers/tmp'

let cleanup: () => Promise<void> = async () => {}
afterEach(() => cleanup())

async function site() {
  const t = await makeTmpDir()
  cleanup = t.cleanup
  const root = join(t.dir, 'side')
  await mkdir(join(root, 'css'), { recursive: true })
  await mkdir(join(root, 'bilder æøå'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'x'), { recursive: true })
  await mkdir(join(root, '.git'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<h1>Hei</h1>')
  await writeFile(join(root, 'css', 'stil.css'), 'body{}')
  await writeFile(join(root, 'bilder æøå', 'Kafé.jpg'), Buffer.from([1, 2, 3]))
  await writeFile(join(root, 'node_modules', 'x', 'a.js'), 'x')
  await writeFile(join(root, '.git', 'HEAD'), 'x')
  await writeFile(join(root, '.DS_Store'), 'x')
  await writeFile(join(t.dir, 'utenfor.txt'), 'hemmelig')
  return { root, outside: t.dir }
}

describe('scanner', () => {
  it('finds files, skips ignored ones and handles Norwegian names', async () => {
    const { root } = await site()
    const res = await scanFolder(root, { ignore: createIgnoreMatcher() })
    expect([...res.files.keys()].sort()).toEqual(['bilder æøå/Kafé.jpg', 'css/stil.css', 'index.html'])
    expect(res.files.get('index.html')!.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(res.ignoredCount).toBe(3)
  })

  it('reuses cached hashes when size and time are unchanged', async () => {
    const { root } = await site()
    const ignore = createIgnoreMatcher()
    const first = await scanFolder(root, { ignore })
    expect(first.hashedCount).toBe(3)
    const second = await scanFolder(root, { ignore, cache: first.cache })
    expect(second.hashedCount).toBe(0)
    await writeFile(join(root, 'index.html'), '<h1>Endret</h1>')
    const third = await scanFolder(root, { ignore, cache: second.cache })
    expect(third.hashedCount).toBe(1)
    expect(third.files.get('index.html')!.hash).not.toBe(first.files.get('index.html')!.hash)
  })

  it('detects content change even if the cache lies about time (same size, new mtime)', async () => {
    const { root } = await site()
    const ignore = createIgnoreMatcher()
    const first = await scanFolder(root, { ignore })
    await writeFile(join(root, 'css', 'stil.css'), 'p{}{}')
    await utimes(join(root, 'css', 'stil.css'), new Date(), new Date(Date.now() + 5000))
    const second = await scanFolder(root, { ignore, cache: first.cache })
    expect(second.files.get('css/stil.css')!.hash).not.toBe(first.files.get('css/stil.css')!.hash)
  })

  it('never follows symbolic links out of the site folder', async () => {
    const { root, outside } = await site()
    await symlink(join(outside, 'utenfor.txt'), join(root, 'lenke.txt'))
    await symlink(join(root, 'index.html'), join(root, 'kopi.html'))
    await symlink(outside, join(root, 'mappelenke'))
    const res = await scanFolder(root, { ignore: createIgnoreMatcher() })
    expect(res.files.has('lenke.txt')).toBe(false)
    expect(res.files.has('kopi.html')).toBe(true)
    expect([...res.files.keys()].some((k) => k.startsWith('mappelenke'))).toBe(false)
    expect(res.warnings.map((w) => w.path)).toContain('lenke.txt')
  })

  it('reports progress', async () => {
    const { root } = await site()
    const seen: string[] = []
    await scanFolder(root, { ignore: createIgnoreMatcher(), onProgress: (p) => seen.push(p.phase) })
    expect(seen).toContain('hashing')
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { mkdir, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { startStaticServer, PHP_ROUTER, type LocalServer } from '../src/core/preview/staticServer'
import { createIgnoreMatcher } from '../src/core/scan/ignoreRules'
import { findPhp, startPhpServer } from '../src/core/php/php'
import { makeTmpDir } from './helpers/tmp'

let cleanup: () => Promise<void> = async () => {}
let server: LocalServer | null = null
afterEach(async () => {
  await server?.stop()
  server = null
  await cleanup()
})

async function site() {
  const t = await makeTmpDir()
  cleanup = t.cleanup
  const root = join(t.dir, 'side')
  await mkdir(join(root, 'om oss'), { recursive: true })
  await mkdir(join(root, 'utkast'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<h1>Forside</h1>')
  await writeFile(join(root, 'om oss', 'index.html'), '<h1>Om oss</h1>')
  await writeFile(join(root, 'stil.css'), 'body{}')
  await writeFile(join(root, '.env'), 'SECRET=x')
  await writeFile(join(root, 'utkast', 'hemmelig.html'), 'utkast')
  await writeFile(join(t.dir, 'utenfor.txt'), 'utenfor')
  await symlink(join(t.dir, 'utenfor.txt'), join(root, 'lenke.txt'))
  return { root, outside: t.dir }
}

describe('static preview server', () => {
  it('serves pages, folders and files with the right content type, on 127.0.0.1 only', async () => {
    const { root } = await site()
    server = await startStaticServer(root, createIgnoreMatcher({ siteRules: 'utkast/' }))
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const front = await fetch(`${server.url}/`)
    expect(await front.text()).toBe('<h1>Forside</h1>')
    const om = await fetch(`${server.url}/om%20oss/`)
    expect(await om.text()).toBe('<h1>Om oss</h1>')
    const css = await fetch(`${server.url}/stil.css`)
    expect(css.headers.get('content-type')).toMatch(/text\/css/)
  })

  it('refuses hidden files, ignored files, paths outside the folder and links out of it', async () => {
    const { root } = await site()
    server = await startStaticServer(root, createIgnoreMatcher({ siteRules: 'utkast/' }))
    for (const p of ['/.env', '/utkast/hemmelig.html', '/../utenfor.txt', '/%2e%2e/utenfor.txt', '/lenke.txt']) {
      const r = await fetch(`${server.url}${p}`)
      expect([p, r.status]).toEqual([p, 404])
    }
  })
})

const php = await findPhp()
describe.runIf(php)('PHP preview with router', () => {
  it('runs PHP but refuses hidden files', async () => {
    const t = await makeTmpDir()
    cleanup = t.cleanup
    const root = join(t.dir, 'side')
    await mkdir(root)
    await writeFile(join(root, 'index.php'), '<?php echo "Sum " . (1 + 1);')
    await writeFile(join(root, '.env'), 'SECRET=x')
    const router = join(t.dir, 'router.php')
    await writeFile(router, PHP_ROUTER)
    const s = await startPhpServer(php!.path, root, undefined, [], router)
    try {
      expect(await (await fetch(`${s.url}/`)).text()).toBe('Sum 2')
      const env = await fetch(`${s.url}/.env`)
      expect(env.status).toBe(404)
      expect(await env.text()).not.toContain('SECRET')
    } finally {
      await s.stop()
    }
  })
})

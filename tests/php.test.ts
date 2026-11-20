import { describe, it, expect, beforeAll } from 'vitest'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { findPhp, phpCandidates, phpLint, startPhpServer, KNOWN_PHP_LOCATIONS, type PhpInfo } from '../src/core/php/php'
import { makeTmpDir } from './helpers/tmp'

let php: PhpInfo | null = null
beforeAll(async () => {
  php = await findPhp()
})

describe('finding PHP', () => {
  it('always looks in the Homebrew locations, also with an empty PATH', () => {
    const c = phpCandidates({ pathEnv: '' })
    for (const loc of KNOWN_PHP_LOCATIONS) expect(c).toContain(loc)
  })

  it('returns null when no candidate exists', async () => {
    // Search only a folder without PHP and no known locations that exist.
    const res = await findPhp({ pathEnv: '/nonexistent-skyv-dir' }).then((r) =>
      r && KNOWN_PHP_LOCATIONS.includes(r.path) ? null : r
    )
    expect(res).toBeNull()
  })
})

// These run on a Mac with PHP installed (e.g. via Homebrew). Without PHP they are skipped,
// just as the app silently skips PHP features.
describe.runIf(await findPhp())('with PHP installed', () => {
  it('finds PHP even when opened from Finder (minimal PATH)', async () => {
    const res = await findPhp({ pathEnv: '/usr/bin:/bin:/usr/sbin:/sbin' })
    expect(res).not.toBeNull()
    expect(res!.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('syntax check accepts valid PHP and reports the line of an error', async () => {
    const t = await makeTmpDir()
    try {
      const good = join(t.dir, 'god æøå.php')
      const bad = join(t.dir, 'feil.php')
      await writeFile(good, '<?php\necho "Hei";\n')
      await writeFile(bad, '<?php\necho "Hei"\necho "mangler semikolon";\n')
      expect(await phpLint(php!.path, good)).toEqual({ ok: true })
      const r = await phpLint(php!.path, bad)
      expect(r.ok).toBe(false)
      expect(r.line).toBe(3)
      expect(r.message).toMatch(/Parse error/)
      expect(r.message).not.toContain(t.dir)
    } finally {
      await t.cleanup()
    }
  })

  it('local preview server runs PHP and serves files', async () => {
    const t = await makeTmpDir()
    try {
      await mkdir(join(t.dir, 'css'))
      await writeFile(join(t.dir, 'index.php'), '<?php echo "Sum: " . (2 + 3);')
      await writeFile(join(t.dir, 'css', 'stil.css'), 'body{color:red}')
      const server = await startPhpServer(php!.path, t.dir)
      try {
        expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
        const page = await fetch(`${server.url}/`)
        expect(page.status).toBe(200)
        expect(await page.text()).toBe('Sum: 5')
        const css = await fetch(`${server.url}/css/stil.css`)
        expect(css.headers.get('content-type')).toMatch(/text\/css/)
      } finally {
        await server.stop()
      }
    } finally {
      await t.cleanup()
    }
  })
})

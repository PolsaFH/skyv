import { describe, it, expect } from 'vitest'
import { runChecks, type CheckInput } from '../src/core/checks/checks'
import { findSecrets, maskSecret, sensitiveFileKind } from '../src/core/checks/secrets'
import type { Change } from '../src/core/manifest/changes'
import type { Finding } from '../src/core/checks/types'

// Fake keys assembled at runtime so this file itself never contains a real-looking secret.
const KEYS = {
  openai: 'sk-' + 'proj-' + 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z',
  anthropic: 'sk-ant-' + 'api03-' + 'Xy7Zq9Wv2Ut5Sr8Qp1On4Ml7Kj0Ih3Gf',
  aws: 'AKIA' + 'IOSFODNN7EXAMPLE',
  google: 'AIza' + 'SyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY',
  stripe: 'sk_live_' + '51H8xYzAbCdEfGhIjKlMnOp',
  github: 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
}

const change = (path: string, size = 100, kind: Change['kind'] = 'modified'): Change => ({ path, kind, size })

async function check(files: Record<string, string>, extra: Partial<CheckInput> = {}): Promise<Finding[]> {
  const changes = extra.changes ?? Object.keys(files).map((p) => change(p, files[p].length))
  return runChecks({
    changes,
    publishedCount: 50,
    localCount: 50,
    deps: { neededBy: {}, missing: [], caseMismatch: [], ignored: [] },
    readText: async (p) => files[p] ?? null,
    allTextFiles: Object.keys(files),
    selectedPaths: new Set(changes.map((c) => c.path)),
    ...extra
  })
}
const ids = (f: Finding[]) => f.map((x) => `${x.severity}:${x.check}:${x.path}${x.line ? ':' + x.line : ''}`)

describe('secret scanner', () => {
  it.each(Object.entries(KEYS))('finds %s keys', (kind, key) => {
    const found = findSecrets('js/app.js', `const config = {\n  key: "${key}"\n}`)
    expect(found.map((f) => f.kind)).toEqual([kind])
  })

  it('finds private key blocks', () => {
    expect(findSecrets('x.txt', '-----BEGIN RSA PRIVATE KEY-----\nabc')[0].kind).toBe('private-key')
    expect(findSecrets('x.txt', '-----BEGIN OPENSSH PRIVATE KEY-----')[0].kind).toBe('private-key')
  })

  it('finds database passwords in PHP config, but not placeholders or variables', () => {
    const php = `<?php
define('DB_PASSWORD', 'Hemmelig!2024');
$db_pass = "annet-passord";
$config = ['password' => 'tredje'];
$conn = new mysqli('localhost', 'bruker', 'fjerde');
$password = $_POST['password'];
define('DB_PASSWORD', '');
$pass = getenv('DB_PASS');
`
    expect(findSecrets('config.php', php).map((s) => s.value)).toEqual(['Hemmelig!2024', 'annet-passord', 'tredje', 'fjerde'])
  })

  it('does not flag password fields in HTML or ordinary CSS class names', () => {
    expect(findSecrets('index.html', '<input type="password" name="password">')).toEqual([])
    expect(findSecrets('css/stil.css', '.sk-navigation-menu-item-active-state { }')).toEqual([])
  })

  it('masks secrets so they are never shown in full', () => {
    expect(maskSecret('anthropic', KEYS.anthropic)).toBe('sk-ant-…3Gf')
    expect(maskSecret('db-password', 'Hemmelig')).toBe('••••••')
  })
})

describe('sensitive files', () => {
  it.each([
    ['.env', 'env'],
    ['config/.env.production', 'env'],
    ['.git/config', 'git'],
    ['id_rsa', 'ssh-key'],
    ['backup/db.sql', 'database-dump'],
    ['dump.sql.gz', 'database-dump'],
    ['index.php.bak', 'backup'],
    ['nettside.zip', 'archive'],
    ['.htpasswd', 'htpasswd'],
    ['server.pem', 'certificate']
  ])('%s is %s', (path, kind) => expect(sensitiveFileKind(path)).toBe(kind))

  it.each(['index.html', 'id_rsa.pub', 'bilder/zipper.png', 'sql.html', 'environment.js'])('%s is fine', (p) => expect(sensitiveFileKind(p)).toBeNull())
})

describe('checks before release', () => {
  it('blocks secrets and sensitive files, with masked values and line numbers', async () => {
    const f = await check({ 'js/app.js': `// oppsett\nconst key = "${KEYS.anthropic}"\n`, 'kopi.zip': 'PK' })
    expect(ids(f)).toEqual(['block:secret:js/app.js:2', 'block:sensitive-file:kopi.zip'])
    expect(f[0].message).toContain('sk-ant-…3Gf')
    expect(f[0].message).not.toContain(KEYS.anthropic)
  })

  it('warns about local links, but not about localhost as a PHP database host', async () => {
    const f = await check({
      'index.html': '<a href="http://localhost:8080/side">x</a>\n<img src="file:///Users/filip/bilde.png">\n<img src="http://192.168.1.20/a.png">',
      'db.php': "<?php $host = 'localhost';"
    })
    expect(ids(f).filter((x) => x.includes('local-link'))).toEqual(['warn:local-link:index.html:1', 'warn:local-link:index.html:2', 'warn:local-link:index.html:3'])
  })

  it('warns about placeholder and test text', async () => {
    const f = await check({ 'om.html': '<p>Lorem ipsum dolor sit amet</p>\n<!-- TODO: skriv om -->\n<p>test123</p>' })
    expect(f.filter((x) => x.check === 'placeholder-text').map((x) => x.line)).toEqual([1, 2, 3])
  })

  it('warns about invalid JSON with line number', async () => {
    const f = await check({ 'data/meny.json': '{\n  "a": 1,\n  "b": \n}' })
    expect(f.find((x) => x.check === 'invalid-json')).toBeTruthy()
    expect((await check({ 'ok.json': '{"a":[1,2]}' })).filter((x) => x.check === 'invalid-json')).toEqual([])
  })

  it('reports PHP syntax errors through the injected linter', async () => {
    const f = await check({ 'index.php': '<?php echo' }, { phpLint: async () => ({ ok: false, line: 1, message: 'Parse error: syntax error' }) })
    expect(ids(f)).toContain('warn:php-syntax:index.php:1')
    // Without PHP the check is skipped silently.
    expect((await check({ 'index.php': '<?php echo' })).some((x) => x.check === 'php-syntax')).toBe(false)
  })

  it('warns about very large files and many deletions', async () => {
    const changes = [change('video.mp4', 11 * 1024 * 1024, 'added'), ...Array.from({ length: 12 }, (_, i) => change(`gammel-${i}.html`, 10, 'deleted'))]
    const f = await check({}, { changes })
    expect(ids(f)).toEqual(expect.arrayContaining(['warn:large-file:video.mp4', 'warn:many-deletions:']))
  })

  it('gives tips about console.log, missing alt text and missing title', async () => {
    const f = await check({
      'js/app.js': 'console.log(1)\nconsole.log(2)',
      'index.html': '<html><head></head><body><img src="a.png"><img src="b.png" alt="B"></body></html>'
    })
    expect(ids(f)).toEqual(['info:missing-title:index.html', 'info:missing-alt:index.html:1', 'info:console-log:js/app.js:1'])
  })

  it('tips about large images nobody uses', async () => {
    const files = { 'index.html': '<img src="bilder/brukt.jpg">' }
    const changes = [change('bilder/brukt.jpg', 500_000, 'added'), change('bilder/ubrukt.jpg', 500_000, 'added')]
    const f = await check(files, { changes, allTextFiles: ['index.html'] })
    expect(ids(f)).toEqual(['info:unused-image:bilder/ubrukt.jpg'])
  })

  it('turns broken references from the dependency scan into warnings', async () => {
    const f = await check(
      { 'index.html': '<img src="x.png" alt="X">' },
      {
        deps: {
          neededBy: { 'bilder/ny.png': ['index.html'] },
          missing: [{ from: 'index.html', line: 1, ref: 'x.png', path: 'x.png' }],
          caseMismatch: [],
          ignored: []
        }
      }
    )
    expect(ids(f)).toEqual(['warn:not-selected:bilder/ny.png', 'warn:broken-link:index.html:1'])
  })

  it('gives each finding a stable key that does not depend on the line', async () => {
    const a = await check({ 'a.js': `x\nconst k = "${KEYS.aws}"` })
    const b = await check({ 'a.js': `x\ny\nz\nconst k = "${KEYS.aws}"` })
    expect(a[0].key).toBe(b[0].key)
    expect(a[0].line).not.toBe(b[0].line)
  })
})

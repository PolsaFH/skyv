import { describe, it, expect } from 'vitest'
import { pagesToCheck, runPostCheck, urlFor, findPhpErrors, type FetchResult } from '../src/core/verify/postCheck'

describe('which pages to check', () => {
  const files: Record<string, string> = {
    'index.php': "<?php include 'inc/header.php'; ?><link href=\"css/stil.css\" rel=\"stylesheet\"><img src=\"bilder/logo.png\">",
    'om/index.html': '<link href="../css/stil.css" rel="stylesheet">',
    'kontakt.php': "<?php require 'inc/header.php'; ?>",
    'inc/header.php': '<nav>meny</nav>',
    'css/stil.css': 'body{background:url(../bilder/bg.jpg)}',
    'bilder/logo.png': '',
    'bilder/bg.jpg': '',
    'bilder/ubrukt.png': ''
  }
  const read = async (p: string) => files[p] ?? null
  const all = Object.keys(files)

  it('checks changed pages directly', async () => {
    expect(await pagesToCheck(['kontakt.php'], all, read)).toEqual([{ path: 'kontakt.php', reason: 'changed' }])
  })

  it('checks the pages that include a changed PHP include', async () => {
    const res = await pagesToCheck(['inc/header.php'], all, read)
    expect(res.map((r) => r.path).sort()).toEqual(['index.php', 'kontakt.php'])
    expect(res[0].via).toBe('inc/header.php')
  })

  it('follows image -> stylesheet -> pages', async () => {
    const res = await pagesToCheck(['bilder/bg.jpg'], all, read)
    expect(res.map((r) => r.path).sort()).toEqual(['index.php', 'om/index.html'])
  })

  it('falls back to the front page for files nobody references', async () => {
    expect(await pagesToCheck(['bilder/ubrukt.png'], all, read)).toEqual([{ path: 'index.php', reason: 'front-page' }])
  })

  it('maps files to public addresses', () => {
    expect(urlFor('https://minside.no/', 'index.html')).toBe('https://minside.no/')
    expect(urlFor('https://minside.no', 'om/index.php')).toBe('https://minside.no/om/')
    expect(urlFor('https://minside.no', 'sider/kafé meny.html')).toBe('https://minside.no/sider/kaf%C3%A9%20meny.html')
  })
})

describe('PHP error detection', () => {
  it('finds PHP errors as PHP prints them', () => {
    expect(findPhpErrors('<br />\n<b>Warning</b>:  Undefined variable $x in <b>/var/www/a.php</b> on line <b>3</b><br />')).toEqual(['PHP-advarsel: Undefined variable $x'])
    expect(findPhpErrors('PHP Fatal error:  Uncaught Error: Call to undefined function f() in /var/www/a.php:2\nStack trace:\n#0 {main}')).toEqual([
      'PHP-feil: Uncaught Error: Call to undefined function f()'
    ])
    expect(findPhpErrors('<b>Parse error</b>: syntax error, unexpected end of file in <b>/x.php</b>')).toEqual(['PHP-feil: syntax error, unexpected end of file'])
  })
  it('does not react to ordinary words', () => {
    expect(findPhpErrors('<p>Warning: hot coffee. Notice: we are closed on Mondays.</p>')).toEqual([])
  })
})

describe('checking the live site (fake web server)', () => {
  const site: Record<string, { status: number; type: string; body?: string }> = {
    '/': { status: 200, type: 'text/html', body: '<link rel="stylesheet" href="css/stil.css"><img src="/bilder/logo.png"><img src="bilder/borte.png"><script src="js/app.js"></script><a href="om.html">Om</a><img src="https://cdn.annen.no/x.png">' },
    '/css/stil.css': { status: 200, type: 'text/css' },
    '/bilder/logo.png': { status: 200, type: 'image/png' },
    '/bilder/borte.png': { status: 404, type: 'text/html' },
    '/js/app.js': { status: 200, type: 'text/html; charset=utf-8' },
    '/kontakt.php': { status: 200, type: 'text/html', body: '<b>Fatal error</b>: Uncaught Error in x.php on line 4' },
    '/mangler.html': { status: 404, type: 'text/html', body: 'Not found' }
  }
  const requested: string[] = []
  const fetcher = async (url: string): Promise<FetchResult> => {
    const u = new URL(url)
    requested.push(u.toString())
    const r = site[u.pathname] ?? { status: 404, type: 'text/html' }
    return { status: r.status, contentType: r.type, body: r.body ?? '', url }
  }

  it('checks the page and the files it uses, and finds broken ones', async () => {
    const res = await runPostCheck('https://minside.no', [{ path: 'index.html', reason: 'changed' }], fetcher, 1700000000000)
    expect(res.ok).toBe(false)
    expect(res.pages[0].ok).toBe(true)
    const bad = res.assets.filter((a) => !a.ok).map((a) => [new URL(a.url).pathname, a.problem])
    expect(bad).toEqual([
      ['/bilder/borte.png', 'Filen svarte 404 (finnes ikke).'],
      ['/js/app.js', 'Serveren sendte en nettside i stedet for filen (ofte en feilside for "finnes ikke").']
    ])
    // Cache-buster on every request, and other sites are never contacted.
    expect(requested.every((u) => u.includes('skyv='))).toBe(true)
    expect(requested.some((u) => u.includes('annen.no'))).toBe(false)
    // Page links (<a href>) are not fetched as files.
    expect(requested.some((u) => u.includes('om.html'))).toBe(false)
  })

  it('reports PHP errors and missing pages', async () => {
    const res = await runPostCheck('https://minside.no', [{ path: 'kontakt.php', reason: 'changed' }, { path: 'mangler.html', reason: 'changed' }], fetcher)
    expect(res.pages.map((p) => p.ok)).toEqual([false, false])
    expect(res.pages[0].problems[0]).toMatch(/PHP-feil/)
    expect(res.pages[1].problems[0]).toBe('Siden svarte 404 (finnes ikke).')
  })

  it('handles no contact at all', async () => {
    const res = await runPostCheck('https://minside.no', [{ path: 'index.html', reason: 'changed' }], async () => {
      throw new Error('ENOTFOUND')
    })
    expect(res.pages[0].problems).toEqual(['Siden fikk ikke kontakt.'])
  })

  it('skips with an explanation when the site has no address', async () => {
    const res = await runPostCheck('', [{ path: 'index.html', reason: 'changed' }], fetcher)
    expect(res.skipped).toMatch(/Nettadressen/)
    expect(res.ok).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { extractReferences, resolveReference } from '../src/core/deps/references'

const refs = (path: string, text: string) => extractReferences(path, text).map((r) => r.ref)
const resolved = (path: string, text: string) =>
  extractReferences(path, text)
    .map((r) => resolveReference(path, r))
    .filter(Boolean)
    .map((r) => r!.path)

describe('reference scanner', () => {
  it('finds src, href, srcset, poster and inline styles in HTML', () => {
    const html = `<!doctype html>
<link rel="stylesheet" href="css/stil.css?v=3">
<script src='js/app.js'></script>
<img src="bilder/hero.jpg" srcset="bilder/hero-2x.jpg 2x, bilder/hero-3x.jpg 3x" alt="">
<video poster="bilder/plakat.png"></video>
<div style="background: url('bilder/bakgrunn.png')"></div>
<a href="https://example.com">x</a> <a href="#topp">opp</a> <a href="mailto:a@b.no">mail</a>
<style>@import "css/ekstra.css"; .x { background: url(bilder/ikon.svg) }</style>
<a href="om-oss/">Om oss</a>`
    expect(resolved('index.html', html)).toEqual([
      'css/stil.css',
      'js/app.js',
      'bilder/hero.jpg',
      'bilder/plakat.png',
      'om-oss',
      'bilder/hero-2x.jpg',
      'bilder/hero-3x.jpg',
      'bilder/bakgrunn.png',
      'bilder/ikon.svg',
      'css/ekstra.css'
    ])
  })

  it('reports correct line numbers', () => {
    const r = extractReferences('a.html', '<p>\n\n<img src="x.png">')
    expect(r[0].line).toBe(3)
  })

  it('finds url() and @import in CSS, relative to the CSS file', () => {
    const css = `@import url("tema.css");\n@import 'fonter.css';\nbody { background: url(../bilder/bg.jpg) }\n.l { background: url(data:image/png;base64,AAA) }`
    expect(resolved('css/stil.css', css)).toEqual(['css/tema.css', 'bilder/bg.jpg', 'css/fonter.css'])
  })

  it('finds relative ES imports but not packages', () => {
    const js = `import { a } from './util.js'\nimport React from 'react'\nconst m = await import('../moduler/m.js')\nexport * from './b.js'`
    expect(resolved('js/app.js', js)).toEqual(['js/util.js', 'moduler/m.js', 'js/b.js'])
  })

  it('finds PHP include and require with relative paths', () => {
    const php = `<?php\ninclude 'inc/header.php';\nrequire_once("inc/db.php");\ninclude __DIR__ . '/inc/meny.php';\nrequire dirname(__FILE__) . '/inc/bunn.php';\ninclude $side . '.php';\n?>\n<img src="<?= $bilde ?>">`
    expect(resolved('index.php', php)).toEqual(['inc/header.php', 'inc/db.php', 'inc/meny.php', 'inc/bunn.php'])
  })

  it('handles root-relative paths, encoded names and ../', () => {
    expect(resolved('sider/om.html', '<img src="/bilder/kaf%C3%A9%20%C3%A6.jpg"><a href="../index.html">')).toEqual(['bilder/kafé æ.jpg', 'index.html'])
  })

  it('never resolves outside the site folder', () => {
    expect(resolved('index.html', '<img src="../../hemmelig.png">')).toEqual([])
  })

  it('ignores template placeholders', () => {
    expect(refs('a.html', '<img src="{{ bilde }}"><a href="${url}">')).toHaveLength(2)
    expect(resolved('a.html', '<img src="{{ bilde }}"><a href="${url}">')).toEqual([])
  })
})

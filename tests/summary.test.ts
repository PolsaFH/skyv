import { describe, it, expect } from 'vitest'
import { ruleSummary, joinNorwegian } from '../src/core/summary/ruleSummary'
import { buildAiPayload, payloadText, aiSummary, AI_INSTRUCTIONS } from '../src/core/summary/aiSummary'
import { textDiff } from '../src/core/diff/textDiff'
import type { Change } from '../src/core/manifest/changes'

const ch = (path: string, kind: Change['kind']): Change => ({ path, kind, size: 10 })

describe('rule-based summary', () => {
  it('matches the example from the description', () => {
    const s = ruleSummary([
      ch('index.html', 'modified'),
      ch('om.html', 'modified'),
      ch('kontakt.html', 'modified'),
      ch('css/stil.css', 'modified'),
      ch('bilder/a.jpg', 'added'),
      ch('bilder/b.png', 'added'),
      ch('gammel.html', 'deleted')
    ])
    expect(s).toBe('Endret 3 HTML-sider og 1 CSS-fil, la til 2 bilder, slettet 1 fil.')
  })

  it('handles single items, renames and other types', () => {
    expect(ruleSummary([ch('meny.php', 'added')])).toBe('La til 1 PHP-fil.')
    expect(ruleSummary([ch('js/app.js', 'modified'), ch('font.woff2', 'modified'), ch('robots.txt', 'modified')])).toBe(
      'Endret 1 JavaScript-fil, 1 skrift og 1 fil.'
    )
    expect(ruleSummary([ch('ny.png', 'renamed'), ch('ny2.png', 'renamed')])).toBe('Ga nytt navn til 2 filer.')
    expect(ruleSummary([])).toBe('Ingen endringer.')
  })

  it('joins lists in Norwegian', () => {
    expect(joinNorwegian(['a'])).toBe('a')
    expect(joinNorwegian(['a', 'b'])).toBe('a og b')
    expect(joinNorwegian(['a', 'b', 'c'])).toBe('a, b og c')
  })

  it('never uses em dashes', () => {
    expect(ruleSummary([ch('a.html', 'added'), ch('b.css', 'modified')])).not.toContain('—')
  })
})

describe('AI summary payload', () => {
  const KEY = 'sk-ant-' + 'api03-' + 'Xy7Zq9Wv2Ut5Sr8Qp1On4Ml7Kj0Ih3Gf'
  const diffs: Record<string, ReturnType<typeof textDiff>> = {
    'index.html': textDiff('<h1>Velkommen</h1>\n<p>Åpent 8-16</p>\n', '<h1>Velkommen til oss</h1>\n<p>Åpent 8-16</p>\n'),
    'js/app.js': textDiff('', `const k = "${KEY}"\nconsole.log(1)\n`),
    'config.php': textDiff('', "<?php define('DB_PASSWORD', 'Hemmelig123');\n"),
    'om.html': textDiff('<p>a</p>\n', `<p>b</p>\n<script>const key = "${KEY}"</script>\n`)
  }
  const changes = [ch('index.html', 'modified'), ch('js/app.js', 'added'), ch('config.php', 'added'), ch('om.html', 'modified'), ch('bilde.jpg', 'added'), ch('gammel.html', 'deleted')]

  it('contains only changed lines, never secrets or flagged files', async () => {
    const payload = await buildAiPayload(changes, async (c) => diffs[c.path] ?? null, new Set(['js/app.js', 'config.php']))
    const text = payloadText(payload)
    expect(text).toContain('+ <h1>Velkommen til oss</h1>')
    expect(text).toContain('- <h1>Velkommen</h1>')
    expect(text).not.toContain('Åpent 8-16') // unchanged line
    expect(text).not.toContain(KEY)
    expect(text).not.toContain('Hemmelig123')
    expect(text).toContain('[linje med hemmelig verdi fjernet]') // om.html had a key on a changed line
    expect(payload.files.find((f) => f.path === 'js/app.js')?.omitted).toMatch(/hemmelig/)
    expect(payload.files.find((f) => f.path === 'bilde.jpg')?.omitted).toBe('Ikke en tekstfil.')
  })

  it('sends exactly the shown text and cleans the answer', async () => {
    const payload = await buildAiPayload([ch('index.html', 'modified')], async (c) => diffs[c.path] ?? null, new Set())
    let sent: { system: string; user: string } | null = null
    const result = await aiSummary(payload, async (system, user) => {
      sent = { system, user }
      return '  Forsiden har fått en ny overskrift — mer innbydende.  '
    })
    expect(sent!.user).toBe(payloadText(payload))
    expect(sent!.system).toBe(AI_INSTRUCTIONS)
    expect(result).toBe('Forsiden har fått en ny overskrift, mer innbydende.')
  })
})

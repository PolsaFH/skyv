import { describe, it, expect } from 'vitest'
import { createIgnoreMatcher, checkIgnoreRules } from '../src/core/scan/ignoreRules'

describe('ignore rules', () => {
  const m = createIgnoreMatcher({ ignoreSourceMaps: true })
  it.each([
    ['.git', true, true],
    ['.git/config', false, true],
    ['node_modules', true, true],
    ['undermappe/node_modules', true, true],
    ['.DS_Store', false, true],
    ['bilder/.DS_Store', false, true],
    ['.env', false, true],
    ['.env.production', false, true],
    ['feil.log', false, true],
    ['js/app.js.map', false, true],
    ['.idea', true, true],
    ['.vscode', true, true],
    ['Thumbs.db', false, true],
    ['.skyvignore', false, true],
    ['index.html', false, false],
    ['css/stil.css', false, false],
    ['environment.html', false, false],
    ['.htaccess', false, false]
  ])('%s -> ignored=%s', (path, isDir, expected) => {
    expect(m(path, isDir)).toBe(expected)
  })

  it('keeps source maps when the option is off', () => {
    expect(createIgnoreMatcher({ ignoreSourceMaps: false })('app.js.map')).toBe(false)
  })

  it('applies .skyvignore and site rules, including negation', () => {
    const mm = createIgnoreMatcher({ skyvignore: 'utkast/\n*.psd\n', siteRules: '*.log\n!viktig.log' })
    expect(mm('utkast', true)).toBe(true)
    expect(mm('bilder/logo.psd')).toBe(true)
    expect(mm('viktig.log')).toBe(false)
    expect(mm('bilder/logo.png')).toBe(false)
  })

  it('is case-insensitive like macOS', () => {
    expect(createIgnoreMatcher({ siteRules: 'Utkast/' })('utkast', true)).toBe(true)
  })

  it('reports suspicious user rules', () => {
    expect(checkIgnoreRules('ok/\n../hemmelig\n# kommentar')).toEqual(['Linje 2: ".." kan ikke brukes i en regel.'])
  })
})

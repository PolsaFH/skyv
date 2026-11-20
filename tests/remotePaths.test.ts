import { describe, it, expect } from 'vitest'
import { joinRemote, normalizeRemotePath, parentOf } from '../src/core/remote/paths'

describe('remote paths', () => {
  it('joins safely', () => {
    expect(joinRemote('/public_html', 'css/stil.css')).toBe('/public_html/css/stil.css')
    expect(joinRemote('/', 'index.html')).toBe('/index.html')
    expect(joinRemote('/www/', 'bilder/æøå bilde.jpg')).toBe('/www/bilder/æøå bilde.jpg')
  })
  it('refuses paths that escape the root', () => {
    expect(() => joinRemote('/www', '../etc/passwd')).toThrow()
    expect(() => joinRemote('/www', 'a/../../b')).toThrow()
    expect(() => joinRemote('/www', '/abs')).toThrow()
    expect(() => normalizeRemotePath('/a/../b')).toThrow()
  })
  it('finds parent', () => {
    expect(parentOf('/a/b/c')).toBe('/a/b')
    expect(parentOf('/a')).toBe('/')
    expect(parentOf('/')).toBe('/')
  })
})

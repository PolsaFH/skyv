import { describe, it, expect } from 'vitest'
import { tempNameFor, isOwnTempFor } from '../src/core/release/publisher'

describe('temporary upload names', () => {
  it('are hidden, in the same folder, and recognisable', () => {
    const t = tempNameFor('/www/bilder/hero æ.jpg')
    expect(t).toMatch(/^\/www\/bilder\/\.hero æ\.jpg\.[0-9a-f]{8}\.skyvtmp$/)
    expect(isOwnTempFor(t.split('/').pop()!, 'hero æ.jpg')).toBe(true)
  })
  it('never match other files', () => {
    expect(isOwnTempFor('hero.jpg', 'hero.jpg')).toBe(false)
    expect(isOwnTempFor('.hero.jpg.skyvtmp', 'hero.jpg')).toBe(false)
    expect(isOwnTempFor('.annen.jpg.0011aabb.skyvtmp', 'hero.jpg')).toBe(false)
    expect(isOwnTempFor('.a+b(1).jpg.0011aabb.skyvtmp', 'a+b(1).jpg')).toBe(true)
  })
})

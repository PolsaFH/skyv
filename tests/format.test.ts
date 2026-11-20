import { describe, it, expect } from 'vitest'
import { formatAgo } from '../src/renderer/src/format'

describe('"Sjekket for … siden"', () => {
  const now = Date.parse('2026-11-12T12:00:00Z')
  const ago = (s: number) => new Date(now - s * 1000).toISOString()
  it.each([
    [10, 'akkurat nå'],
    [60, 'for ett minutt siden'],
    [120, 'for 2 minutter siden'],
    [3600, 'for en time siden'],
    [3 * 3600, 'for 3 timer siden']
  ])('%i seconds -> %s', (s, text) => expect(formatAgo(ago(s), now)).toBe(text))
})

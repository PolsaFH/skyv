import { describe, it, expect } from 'vitest'
import { textDiff } from '../src/core/diff/textDiff'

describe('text diff', () => {
  it('marks added and removed lines with line numbers', () => {
    const d = textDiff('a\nb\nc\n', 'a\nB\nc\nd\n')
    expect(d.added).toBe(2)
    expect(d.removed).toBe(1)
    expect(d.rows).toEqual([
      { kind: 'same', oldNo: 1, newNo: 1, text: 'a' },
      { kind: 'removed', oldNo: 2, text: 'b' },
      { kind: 'added', newNo: 2, text: 'B' },
      { kind: 'same', oldNo: 3, newNo: 3, text: 'c' },
      { kind: 'added', newNo: 4, text: 'd' }
    ])
  })

  it('collapses long unchanged stretches', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `linje ${i}`)
    const changed = [...lines]
    changed[25] = 'endret'
    const d = textDiff(lines.join('\n'), changed.join('\n'))
    const gaps = d.rows.filter((r) => r.kind === 'gap')
    expect(gaps).toHaveLength(2)
    expect(d.rows.length).toBeLessThan(15)
  })

  it('ignores Windows line endings', () => {
    expect(textDiff('a\r\nb', 'a\nb').identical).toBe(true)
  })
})

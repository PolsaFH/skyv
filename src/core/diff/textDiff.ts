import { diffLines } from 'diff'

export type DiffRowKind = 'same' | 'added' | 'removed' | 'gap'

export interface DiffRow {
  kind: DiffRowKind
  /** Line number in the old version (same/removed). */
  oldNo?: number
  /** Line number in the new version (same/added). */
  newNo?: number
  text: string
  /** For "gap": number of unchanged lines hidden. */
  hidden?: number
}

export interface TextDiff {
  rows: DiffRow[]
  added: number
  removed: number
  identical: boolean
}

/**
 * Line-by-line difference. Unchanged stretches longer than 2*context are collapsed into a "gap" row.
 */
export function textDiff(oldText: string, newText: string, context = 3): TextDiff {
  const parts = diffLines(oldText.replace(/\r\n/g, '\n'), newText.replace(/\r\n/g, '\n'))
  const all: DiffRow[] = []
  let o = 1
  let n = 1
  let added = 0
  let removed = 0
  for (const part of parts) {
    const lines = part.value.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    for (const line of lines) {
      if (part.added) {
        all.push({ kind: 'added', newNo: n++, text: line })
        added++
      } else if (part.removed) {
        all.push({ kind: 'removed', oldNo: o++, text: line })
        removed++
      } else {
        all.push({ kind: 'same', oldNo: o++, newNo: n++, text: line })
      }
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  while (i < all.length) {
    if (all[i].kind !== 'same') {
      rows.push(all[i++])
      continue
    }
    let j = i
    while (j < all.length && all[j].kind === 'same') j++
    const run = all.slice(i, j)
    const keepBefore = i === 0 ? 0 : context
    const keepAfter = j === all.length ? 0 : context
    if (run.length > keepBefore + keepAfter + 1) {
      rows.push(...run.slice(0, keepBefore))
      rows.push({ kind: 'gap', text: '', hidden: run.length - keepBefore - keepAfter })
      rows.push(...run.slice(run.length - keepAfter))
    } else {
      rows.push(...run)
    }
    i = j
  }
  return { rows, added, removed, identical: added === 0 && removed === 0 }
}

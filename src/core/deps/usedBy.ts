import { canHaveReferences, extractReferences, resolveReference } from './references'

const INDEX_NAMES = ['index.html', 'index.htm', 'index.php']

/**
 * Reverse reference index: for each file, the files that reference it (pages, stylesheets,
 * scripts, PHP includes). `extraTargets` are paths that may not exist locally but should still
 * be matched (for example files that are missing on the server and deleted on the Mac).
 */
export async function buildUsedByIndex(
  allFiles: string[],
  readText: (p: string) => Promise<string | null>,
  extraTargets: Iterable<string> = []
): Promise<Map<string, Set<string>>> {
  const usedBy = new Map<string, Set<string>>()
  const known = new Set([...allFiles, ...extraTargets])
  for (const f of allFiles) {
    if (!canHaveReferences(f)) continue
    const text = await readText(f)
    if (text === null) continue
    for (const raw of extractReferences(f, text)) {
      const r = resolveReference(f, raw)
      if (!r) continue
      let target = r.path
      if (r.isFolder || !known.has(target)) {
        const idx = INDEX_NAMES.map((n) => (target ? `${target}/${n}` : n)).find((c) => known.has(c))
        if (!idx) continue
        target = idx
      }
      if (target === f) continue
      ;(usedBy.get(target) ?? usedBy.set(target, new Set()).get(target)!).add(f)
    }
  }
  return usedBy
}

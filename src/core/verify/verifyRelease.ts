import type { Release } from '../release/types'
import type { SiteWorkspace } from '../workspace'
import { undoRelease, type UndoDeps } from '../release/undo'
import { pagesToCheck, runPostCheck, type Fetcher, type PostCheckResult } from './postCheck'
import { isTextPath } from '../files/fileTypes'

/**
 * After a release: load the affected pages from the real web address and check them.
 * The result is saved on the release. If the check fails and the site has
 * "Angre automatisk hvis sjekken feiler" turned on, the release is undone right away.
 */
export async function verifyRelease(
  deps: UndoDeps & { workspace: SiteWorkspace },
  release: Release,
  fetcher: Fetcher,
  opts: { allowAutoUndo?: boolean } = {}
): Promise<Release> {
  const changed = release.items.filter((i) => i.state === 'done' && i.action !== 'delete').map((i) => i.path)
  const deleted = release.items.filter((i) => i.state === 'done' && i.action === 'delete')
  const all = deps.workspace.scannedPaths.length > 0 ? deps.workspace.scannedPaths : changed
  const pages = await pagesToCheck(
    // Deleting a file can break the pages that used it, so check the front page too.
    deleted.length > 0 && changed.length === 0 ? ['index.html'] : changed,
    all.filter((p) => isTextPath(p) || changed.includes(p)),
    (p) => deps.workspace.readText(p)
  )
  let result: PostCheckResult = await runPostCheck(deps.site.url, pages, fetcher)
  let updated: Release = { ...release, check: result }
  await deps.releases.save(updated)

  if (!result.ok && !result.skipped && deps.site.settings.autoUndoOnFailedCheck && opts.allowAutoUndo !== false) {
    try {
      updated = await undoRelease(deps, release.id)
      result = { ...result, autoUndone: true }
      updated = { ...updated, check: result }
      await deps.releases.save(updated)
    } catch {
      // Keep the failed check visible; the user can still undo by hand.
    }
  }
  return updated
}

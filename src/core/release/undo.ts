import type { Site } from '../types'
import type { SiteWorkspace } from '../workspace'
import type { RemoteClient } from '../remote/types'
import type { ManifestEntry } from '../manifest/manifest'
import { joinRemote, parentOf } from '../remote/paths'
import { UserError } from '../errors'
import { tempNameFor } from './publisher'
import type { ReleaseStore, SnapshotStore, Journal } from './stores'
import type { Release, ReleaseItem, ReleaseProgress } from './types'

export interface UndoStep {
  /** Path on the site. */
  path: string
  /** "restore": put the old version back. "remove": the file was new, remove it. */
  action: 'restore' | 'remove'
}

/** What undoing (all or some of) a release will do. Used for the confirmation dialog. */
export function planUndo(release: Release, paths?: string[]): UndoStep[] {
  const wanted = paths ? new Set(paths) : null
  const steps: UndoStep[] = []
  for (const item of release.items) {
    if (item.state !== 'done' || item.undone) continue
    if (wanted && !wanted.has(item.path)) continue
    if (item.action === 'upload') steps.push({ path: item.path, action: item.existedBefore ? 'restore' : 'remove' })
    else if (item.action === 'delete') {
      if (item.existedBefore) steps.push({ path: item.path, action: 'restore' })
    } else {
      steps.push({ path: item.path, action: item.existedBefore ? 'restore' : 'remove' })
      if (item.from && item.fromExistedBefore) steps.push({ path: item.from, action: 'restore' })
    }
  }
  return steps
}

export interface UndoDeps {
  site: Site
  workspace: SiteWorkspace
  releases: ReleaseStore
  snapshots: SnapshotStore
  journal: Journal
  connect: () => Promise<RemoteClient>
  onProgress?: (p: ReleaseProgress) => void
}

/**
 * Undo a release (or selected files): restore overwritten and deleted files from the snapshot,
 * and remove files that the release added. The manifest is updated to match what is on the server,
 * so the local versions show up as changes again.
 */
export async function undoRelease(deps: UndoDeps, releaseId: string, paths?: string[]): Promise<Release> {
  const release = await deps.releases.get(releaseId)
  if (!release) throw new UserError('Fant ikke utgivelsen.')
  if (release.snapshot !== 'kept') {
    throw new UserError('Denne utgivelsen kan ikke angres lenger.', 'Sikkerhetskopien er fjernet fordi den var blant de eldste. Du kan endre hvor mange som beholdes i innstillingene.')
  }
  const steps = planUndo(release, paths)
  if (steps.length === 0) throw new UserError('Det er ingenting å angre i denne utgivelsen.')
  const index = await deps.snapshots.index(releaseId)
  const remote = (rel: string) => joinRemote(deps.site.remoteRoot, rel)
  const failures: string[] = []
  const manifestOps: Array<(f: Record<string, ManifestEntry>) => void> = []

  await deps.journal.set(releaseId, 'undo')
  let client: RemoteClient | null = null
  const getClient = async () => (client ??= await deps.connect())
  let done = 0
  try {
    for (const step of steps) {
      try {
        const c = await getClient()
        if (step.action === 'remove') {
          await c.remove(remote(step.path)).catch(async (err) => {
            // Already gone is fine.
            if (await c.stat(remote(step.path))) throw err
          })
          manifestOps.push((f) => {
            delete f[step.path]
          })
        } else {
          const info = index.files[step.path]
          const local = deps.snapshots.filePath(releaseId, step.path)
          if (!info) throw new UserError(`Fant ikke sikkerhetskopien av ${step.path}.`)
          const target = remote(step.path)
          if (parentOf(target) !== '/') await c.ensureDir(parentOf(target))
          const tmp = tempNameFor(target)
          try {
            await c.upload(local, tmp)
            await c.rename(tmp, target)
          } catch (err) {
            await c.remove(tmp).catch(() => undefined)
            throw err
          }
          const st = await c.stat(target)
          await deps.workspace.copies.putFile(info.hash, step.path, local, info.size).catch(() => undefined)
          manifestOps.push((f) => {
            f[step.path] = {
              hash: info.hash,
              size: info.size,
              localMtimeMs: 0,
              remoteSize: st?.size,
              remoteMtimeMs: st?.modifiedAt,
              publishedAt: new Date().toISOString(),
              releaseId
            }
          })
        }
      } catch (err) {
        failures.push(step.path)
        if (client) {
          await (client as RemoteClient).close().catch(() => undefined)
          client = null
        }
        void err
      }
      done++
      deps.onProgress?.({
        siteId: release.siteId,
        releaseId,
        phase: 'undo',
        items: [{ path: step.path, state: failures.includes(step.path) ? 'failed' : 'done' }],
        doneCount: done,
        totalCount: steps.length,
        doneBytes: 0,
        totalBytes: 0
      })
    }
  } finally {
    if (client) await (client as RemoteClient).close().catch(() => undefined)
  }

  await deps.workspace.manifest.update((m) => manifestOps.forEach((op) => op(m.files)))
  const undonePaths = new Set(steps.map((s) => s.path).filter((p) => !failures.includes(p)))
  const items: ReleaseItem[] = release.items.map((i) =>
    i.state === 'done' && undonePaths.has(i.path) && (!i.from || !i.fromExistedBefore || undonePaths.has(i.from)) ? { ...i, undone: true } : i
  )
  const doneItems = items.filter((i) => i.state === 'done')
  const updated: Release = {
    ...release,
    items,
    status: doneItems.every((i) => i.undone) ? 'undone' : doneItems.some((i) => i.undone) ? 'partly-undone' : release.status,
    undoneAt: new Date().toISOString()
  }
  await deps.releases.save(updated)
  await deps.journal.clear()
  if (failures.length > 0) {
    throw new UserError(
      `${failures.length === 1 ? '1 fil' : `${failures.length} filer`} kunne ikke angres: ${failures.slice(0, 5).join(', ')}${failures.length > 5 ? ' …' : ''}`,
      'Resten er angret. Prøv igjen for å angre de siste.'
    )
  }
  return updated
}


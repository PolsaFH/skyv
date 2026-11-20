import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJsonAtomic, Mutex } from '../storage/atomicJson'
import { newestFirst, type Release } from './types'
import { UserError } from '../errors'

/** All releases for one site, newest first, in `releases.json`. */
export class ReleaseStore {
  private mutex = new Mutex()

  constructor(private readonly siteDir: string) {}

  get file(): string {
    return join(this.siteDir, 'releases.json')
  }

  async list(): Promise<Release[]> {
    const all = await readJson<Release[]>(this.file, [])
    return all.sort(newestFirst)
  }

  async get(id: string): Promise<Release | undefined> {
    return (await this.list()).find((r) => r.id === id)
  }

  async save(release: Release): Promise<void> {
    await this.mutex.run(async () => {
      const all = await readJson<Release[]>(this.file, [])
      const i = all.findIndex((r) => r.id === release.id)
      if (i >= 0) all[i] = release
      else all.push(release)
      await writeJsonAtomic(this.file, all.sort(newestFirst))
    })
  }
}

export interface SnapshotFileInfo {
  hash: string
  size: number
}

export interface SnapshotIndex {
  files: Record<string, SnapshotFileInfo>
}

/**
 * Copies of server files taken before a release overwrote or deleted them.
 * Layout: snapshots/<releaseId>/files/<relative path> + snapshots/<releaseId>/index.json
 */
export class SnapshotStore {
  private mutex = new Mutex()

  constructor(private readonly siteDir: string) {}

  dir(releaseId: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(releaseId)) throw new Error('Invalid release id')
    return join(this.siteDir, 'snapshots', releaseId)
  }

  filePath(releaseId: string, rel: string): string {
    const parts = rel.split('/')
    if (rel.startsWith('/') || parts.some((p) => p === '..' || p === '')) throw new UserError('Ugyldig filsti i sikkerhetskopien.')
    return join(this.dir(releaseId), 'files', ...parts)
  }

  async index(releaseId: string): Promise<SnapshotIndex> {
    return readJson<SnapshotIndex>(join(this.dir(releaseId), 'index.json'), { files: {} })
  }

  async record(releaseId: string, rel: string, info: SnapshotFileInfo): Promise<void> {
    await this.mutex.run(async () => {
      const idx = await this.index(releaseId)
      idx.files[rel] = info
      await writeJsonAtomic(join(this.dir(releaseId), 'index.json'), idx)
    })
  }

  async exists(releaseId: string): Promise<boolean> {
    return fs.access(this.dir(releaseId)).then(
      () => true,
      () => false
    )
  }

  async bytes(releaseId: string): Promise<number> {
    const idx = await this.index(releaseId)
    return Object.values(idx.files).reduce((n, f) => n + f.size, 0)
  }

  async remove(releaseId: string): Promise<void> {
    await fs.rm(this.dir(releaseId), { recursive: true, force: true })
  }
}

/**
 * Apply retention: keep snapshots for the newest `keep` releases and at most `maxBytes` in total.
 * Returns ids whose snapshot was removed. Release records are kept; only the backup copies go.
 */
export async function pruneSnapshots(releases: ReleaseStore, snapshots: SnapshotStore, keep: number, maxBytes: number): Promise<string[]> {
  const list = await releases.list()
  const removed: string[] = []
  let total = 0
  let kept = 0
  for (const r of list) {
    if (r.snapshot !== 'kept') continue
    if (r.status === 'in-progress') {
      total += r.snapshotBytes
      continue
    }
    const fits = kept < keep && total + r.snapshotBytes <= maxBytes
    if (fits) {
      kept++
      total += r.snapshotBytes
    } else {
      await snapshots.remove(r.id)
      await releases.save({ ...r, snapshot: 'pruned' })
      removed.push(r.id)
    }
  }
  return removed
}

/** Marker for a release that was started but not finished (crash, power loss). */
export class Journal {
  constructor(private readonly siteDir: string) {}

  get file(): string {
    return join(this.siteDir, 'in-progress.json')
  }

  async get(): Promise<{ releaseId: string; kind: 'release' | 'undo' } | null> {
    return readJson(this.file, null)
  }

  async set(releaseId: string, kind: 'release' | 'undo'): Promise<void> {
    await writeJsonAtomic(this.file, { releaseId, kind })
  }

  async clear(): Promise<void> {
    await fs.rm(this.file, { force: true })
  }
}

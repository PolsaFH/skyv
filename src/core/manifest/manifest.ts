import { join } from 'node:path'
import { readJson, writeJsonAtomic, Mutex } from '../storage/atomicJson'

/** What Skyv knows about a file as it was when it was last given out (or taken as starting point). */
export interface ManifestEntry {
  hash: string
  size: number
  localMtimeMs: number
  /** Size on the server right after upload, if known. */
  remoteSize?: number
  /** Modification time on the server right after upload (ms), if the server reports it reliably. */
  remoteMtimeMs?: number
  publishedAt: string
  releaseId?: string
}

export interface Manifest {
  version: 1
  createdAt: string
  updatedAt: string
  files: Record<string, ManifestEntry>
}

export function emptyManifest(): Manifest {
  const now = new Date().toISOString()
  return { version: 1, createdAt: now, updatedAt: now, files: {} }
}

/**
 * Per-site manifest, stored as `manifest.json` in the site's data folder.
 * A missing file means "no starting point yet". Writes are atomic and serialised, so the
 * manifest is never half-written, and entries can be updated one file at a time during upload.
 */
export class ManifestStore {
  private mutex = new Mutex()

  constructor(private readonly siteDir: string) {}

  get file(): string {
    return join(this.siteDir, 'manifest.json')
  }

  async load(): Promise<Manifest | null> {
    return readJson<Manifest | null>(this.file, null)
  }

  async save(manifest: Manifest): Promise<void> {
    await this.mutex.run(() => writeJsonAtomic(this.file, { ...manifest, updatedAt: new Date().toISOString() }))
  }

  /** Apply a change to the stored manifest atomically (read, modify, write under one lock). */
  async update(fn: (m: Manifest) => void): Promise<Manifest> {
    return this.mutex.run(async () => {
      const m = (await readJson<Manifest | null>(this.file, null)) ?? emptyManifest()
      fn(m)
      m.updatedAt = new Date().toISOString()
      await writeJsonAtomic(this.file, m)
      return m
    })
  }
}

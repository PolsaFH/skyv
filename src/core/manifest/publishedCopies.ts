import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '../storage/atomicJson'
import { isTextPath, MAX_TEXT_COPY_BYTES } from '../files/fileTypes'

/**
 * Content-addressed copies of text files as they were given out, so the change list can show
 * what changed without contacting the server. Images and large files are not kept here.
 */
export class PublishedCopies {
  constructor(private readonly dir: string) {}

  private fileFor(hash: string): string {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid hash')
    return join(this.dir, hash.slice(0, 2), hash)
  }

  static shouldKeep(path: string, size: number): boolean {
    return isTextPath(path) && size <= MAX_TEXT_COPY_BYTES
  }

  async has(hash: string): Promise<boolean> {
    return fs.access(this.fileFor(hash)).then(
      () => true,
      () => false
    )
  }

  async put(hash: string, content: Uint8Array): Promise<void> {
    if (await this.has(hash)) return
    await writeFileAtomic(this.fileFor(hash), content, 0o600)
  }

  /** Copy a local file into the store if it is a kept type. */
  async putFile(hash: string, relPath: string, absPath: string, size: number): Promise<void> {
    if (!PublishedCopies.shouldKeep(relPath, size)) return
    if (await this.has(hash)) return
    await this.put(hash, await fs.readFile(absPath))
  }

  async get(hash: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.fileFor(hash))
    } catch {
      return null
    }
  }

  /** Remove copies whose hash is no longer referenced. */
  async prune(keep: Set<string>): Promise<number> {
    let removed = 0
    let dirs: string[]
    try {
      dirs = await fs.readdir(this.dir)
    } catch {
      return 0
    }
    for (const d of dirs) {
      const sub = join(this.dir, d)
      const names = await fs.readdir(sub).catch(() => [] as string[])
      for (const n of names) {
        if (!keep.has(n)) {
          await fs.rm(join(sub, n), { force: true })
          removed++
        }
      }
    }
    return removed
  }
}

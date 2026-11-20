import { promises as fs } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * Read a JSON file. Returns `fallback` if the file does not exist.
 * A corrupt file is moved aside (never deleted) and `fallback` is returned.
 */
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw err
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    const aside = `${path}.corrupt-${Date.now()}`
    await fs.rename(path, aside).catch(() => undefined)
    return fallback
  }
}

/**
 * Write JSON atomically: write to a temp file in the same folder, fsync, then rename over the target.
 * A crash leaves either the old or the new file, never a half-written one.
 */
export async function writeJsonAtomic(path: string, data: unknown, mode = 0o600): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(data, null, 2) + '\n', mode)
}

export async function writeFileAtomic(path: string, data: string | Uint8Array, mode = 0o600): Promise<void> {
  const dir = dirname(path)
  await fs.mkdir(dir, { recursive: true })
  const tmp = join(dir, `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
  const handle = await fs.open(tmp, 'w', mode)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.rename(tmp, path)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}

/** Serialises async operations so concurrent writers to the same file never interleave. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn)
    this.tail = next.catch(() => undefined)
    return next
  }
}

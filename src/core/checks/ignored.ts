import { join } from 'node:path'
import { readJson, writeJsonAtomic, Mutex } from '../storage/atomicJson'
import type { Finding } from './types'

interface IgnoredFile {
  keys: string[]
}

/** Findings the user chose to ignore for one site ("Ignorer dette funnet"). */
export class IgnoredFindings {
  private mutex = new Mutex()

  constructor(private readonly siteDir: string) {}

  private get file(): string {
    return join(this.siteDir, 'ignored-findings.json')
  }

  async keys(): Promise<Set<string>> {
    return new Set((await readJson<IgnoredFile>(this.file, { keys: [] })).keys)
  }

  async add(key: string): Promise<void> {
    await this.mutex.run(async () => {
      const cur = await readJson<IgnoredFile>(this.file, { keys: [] })
      if (!cur.keys.includes(key)) cur.keys.push(key)
      await writeJsonAtomic(this.file, cur)
    })
  }

  async clear(): Promise<void> {
    await this.mutex.run(() => writeJsonAtomic(this.file, { keys: [] }))
  }

  /** Split findings into active and ignored. */
  async filter(findings: Finding[]): Promise<{ active: Finding[]; ignoredCount: number }> {
    const keys = await this.keys()
    const active = findings.filter((f) => !keys.has(f.key))
    return { active, ignoredCount: findings.length - active.length }
  }
}

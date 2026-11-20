import { join } from 'node:path'
import { readJson, writeJsonAtomic } from '../storage/atomicJson'
import type { PostCheckResult } from './postCheck'

export interface StoredHealthCheck {
  at: string
  /** "release": the check after a release; "manual": run on request. */
  source: 'release' | 'manual'
  releaseId?: string
  result: PostCheckResult
}

/** The most recent check of the live site, per site (`health-check.json`). */
export class HealthCheckStore {
  constructor(private readonly siteDir: string) {}

  private get file(): string {
    return join(this.siteDir, 'health-check.json')
  }

  last(): Promise<StoredHealthCheck | null> {
    return readJson<StoredHealthCheck | null>(this.file, null)
  }

  save(entry: StoredHealthCheck): Promise<void> {
    return writeJsonAtomic(this.file, entry)
  }
}

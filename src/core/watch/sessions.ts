import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readJson, writeJsonAtomic, Mutex } from '../storage/atomicJson'

/** A burst of local changes, e.g. one round of edits by an AI, separated by a quiet period. */
export interface WorkSession {
  id: string
  startedAt: string
  endedAt: string
  /** Site-relative paths touched during the session. */
  paths: string[]
}

export interface SessionTrackerOptions {
  /** How long things must be quiet before a session is considered finished (ms). */
  quietMs: number
  onSession: (s: WorkSession) => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

/**
 * Collects file events and emits one session when they stop for `quietMs`.
 * Pure logic; timers are injectable so it can be tested without waiting.
 */
export class SessionTracker {
  private paths = new Set<string>()
  private startedAt: number | null = null
  private timer: unknown = null

  constructor(private readonly opts: SessionTrackerOptions) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now()
  }

  touch(path: string): void {
    if (this.startedAt === null) this.startedAt = this.now()
    this.paths.add(path)
    if (this.timer !== null) (this.opts.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>)
    this.timer = (this.opts.setTimer ?? setTimeout)(() => this.flush(), this.opts.quietMs)
  }

  /** End the current session now (if any). */
  flush(): void {
    if (this.timer !== null) (this.opts.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>)
    this.timer = null
    if (this.startedAt === null || this.paths.size === 0) return
    const session: WorkSession = {
      id: randomUUID(),
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: new Date(this.now()).toISOString(),
      paths: [...this.paths].sort()
    }
    this.paths.clear()
    this.startedAt = null
    this.opts.onSession(session)
  }

  get pending(): number {
    return this.paths.size
  }

  stop(): void {
    if (this.timer !== null) (this.opts.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>)
    this.timer = null
    this.paths.clear()
    this.startedAt = null
  }
}

/** Recent sessions for one site, so the change list can show which session a file came from. */
export class SessionStore {
  private mutex = new Mutex()

  constructor(
    private readonly siteDir: string,
    private readonly keep = 30
  ) {}

  private get file(): string {
    return join(this.siteDir, 'sessions.json')
  }

  async list(): Promise<WorkSession[]> {
    return readJson<WorkSession[]>(this.file, [])
  }

  async add(s: WorkSession): Promise<void> {
    await this.mutex.run(async () => {
      const all = await readJson<WorkSession[]>(this.file, [])
      all.push(s)
      await writeJsonAtomic(this.file, all.slice(-this.keep))
    })
  }

  /** Latest session that touched each path. */
  async byPath(): Promise<Map<string, WorkSession>> {
    const map = new Map<string, WorkSession>()
    for (const s of await this.list()) for (const p of s.paths) map.set(p, s)
    return map
  }
}

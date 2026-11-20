import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Mutex } from '../storage/atomicJson'
import { redact } from '../errors'

export type LogAction =
  | 'site-created'
  | 'site-updated'
  | 'starting-point'
  | 'compare'
  | 'release'
  | 'release-retry'
  | 'undo'
  | 'auto-undo'
  | 'check'
  | 'finding-ignored'
  | 'findings-reset'
  | 'export'
  | 'import'
  | 'server-check'
  | 'server-deviation'
  | 'ai'

export interface LogEntry {
  at: string
  action: LogAction
  /** Norwegian, readable. Never contains passwords or keys. */
  message: string
  /** Optional details, e.g. file names. */
  details?: string[]
}

const MAX_BYTES = 1024 * 1024

/**
 * Append-only log of actions for one site (`log.jsonl`). Everything is passed through `redact`
 * before it is written, as an extra guard against secrets ending up in the log.
 */
export class SiteLog {
  private mutex = new Mutex()

  constructor(
    private readonly siteDir: string,
    /** Known secrets for this site (password), removed from anything written. */
    private readonly secrets: () => Promise<Array<string | undefined>> = async () => []
  ) {}

  private get file(): string {
    return join(this.siteDir, 'log.jsonl')
  }

  async add(action: LogAction, message: string, details?: string[]): Promise<void> {
    const secrets = await this.secrets().catch(() => [])
    const entry: LogEntry = {
      at: new Date().toISOString(),
      action,
      message: redact(message, secrets),
      details: details?.slice(0, 200).map((d) => redact(d, secrets))
    }
    await this.mutex.run(async () => {
      await fs.mkdir(this.siteDir, { recursive: true })
      await fs.appendFile(this.file, JSON.stringify(entry) + '\n', { mode: 0o600 })
      // Keep the log from growing forever: keep the newest half when it gets large.
      const st = await fs.stat(this.file)
      if (st.size > MAX_BYTES) {
        const lines = (await fs.readFile(this.file, 'utf8')).trim().split('\n')
        const keep = lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n'
        const tmp = `${this.file}.tmp`
        await fs.writeFile(tmp, keep, { mode: 0o600 })
        await fs.rename(tmp, this.file)
      }
    })
  }

  /** Newest first. */
  async list(limit = 500): Promise<LogEntry[]> {
    let text: string
    try {
      text = await fs.readFile(this.file, 'utf8')
    } catch {
      return []
    }
    const out: LogEntry[] = []
    for (const line of text.trim().split('\n').reverse()) {
      if (!line) continue
      try {
        out.push(JSON.parse(line) as LogEntry)
      } catch {
        /* skip a damaged line */
      }
      if (out.length >= limit) break
    }
    return out
  }

  /** Plain text version for "Kopier logg". */
  static toText(entries: LogEntry[]): string {
    return entries
      .map((e) => `${e.at}  ${e.message}${e.details && e.details.length > 0 ? '\n    ' + e.details.join('\n    ') : ''}`)
      .join('\n')
  }
}

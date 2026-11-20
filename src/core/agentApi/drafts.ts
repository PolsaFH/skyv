import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readJson, writeJsonAtomic, Mutex } from '../storage/atomicJson'
import type { ChangeKind } from '../manifest/changes'

/** Drafts expire after 24 hours; an older draft can only be given out by the user in the app. */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface DraftFile {
  /** changeKey of the change when the draft was made. */
  key: string
  path: string
  kind: ChangeKind
  from?: string
  /** Content hash when the draft was made, to notice later edits. */
  hash?: string
  /** Included automatically because a selected file needs it. */
  neededBy?: string[]
}

export interface Draft {
  id: string
  siteId: string
  createdAt: string
  updatedAt: string
  /** Name of the AI client that made it, e.g. "Claude Code". */
  createdBy: string
  note: string
  files: DraftFile[]
  /** Findings when the draft was made or last updated. */
  findings: { blocking: number; warnings: number; tips: number }
  status: 'open' | 'released' | 'discarded'
  releaseId?: string
}

export interface UndoRequest {
  id: string
  siteId: string
  releaseId: string
  /** Text from the AI explaining why. Shown to the user as the AI's words. */
  reason: string
  requestedBy: string
  createdAt: string
  status: 'open' | 'done' | 'rejected'
}

interface DraftFile_ {
  drafts: Draft[]
  undoRequests: UndoRequest[]
}

/** Drafts and undo requests made by AI clients, per site (`drafts.json`). */
export class DraftStore {
  private mutex = new Mutex()

  constructor(private readonly siteDir: string) {}

  private get file(): string {
    return join(this.siteDir, 'drafts.json')
  }

  private read(): Promise<DraftFile_> {
    return readJson<DraftFile_>(this.file, { drafts: [], undoRequests: [] })
  }

  private write(fn: (d: DraftFile_) => void): Promise<DraftFile_> {
    return this.mutex.run(async () => {
      const d = await this.read()
      fn(d)
      // Keep the file small: open items plus the 50 most recent closed ones.
      const closed = (x: { status: string }) => x.status !== 'open'
      d.drafts = [...d.drafts.filter((x) => !closed(x)), ...d.drafts.filter(closed).slice(-50)]
      d.undoRequests = [...d.undoRequests.filter((x) => !closed(x)), ...d.undoRequests.filter(closed).slice(-50)]
      await writeJsonAtomic(this.file, d)
      return d
    })
  }

  async open(): Promise<Draft[]> {
    return (await this.read()).drafts.filter((d) => d.status === 'open')
  }

  async get(id: string): Promise<Draft | undefined> {
    return (await this.read()).drafts.find((d) => d.id === id)
  }

  /** A new draft replaces any earlier open draft for the site (there is one proposal at a time). */
  async create(d: Omit<Draft, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<Draft> {
    const now = new Date().toISOString()
    const draft: Draft = { ...d, id: randomUUID(), createdAt: now, updatedAt: now, status: 'open' }
    await this.write((f) => {
      for (const x of f.drafts) if (x.status === 'open') x.status = 'discarded'
      f.drafts.push(draft)
    })
    return draft
  }

  async update(id: string, patch: Partial<Pick<Draft, 'note' | 'files' | 'findings' | 'status' | 'releaseId'>>): Promise<Draft> {
    let out: Draft | undefined
    await this.write((f) => {
      const x = f.drafts.find((d) => d.id === id)
      if (x) {
        Object.assign(x, patch, { updatedAt: new Date().toISOString() })
        out = { ...x }
      }
    })
    if (!out) throw new Error('Draft not found')
    return out
  }

  async openUndoRequests(): Promise<UndoRequest[]> {
    return (await this.read()).undoRequests.filter((u) => u.status === 'open')
  }

  async requestUndo(r: Omit<UndoRequest, 'id' | 'createdAt' | 'status'>): Promise<UndoRequest> {
    const req: UndoRequest = { ...r, id: randomUUID(), createdAt: new Date().toISOString(), status: 'open' }
    await this.write((f) => {
      // One open request per release is enough.
      for (const u of f.undoRequests) if (u.status === 'open' && u.releaseId === r.releaseId) u.status = 'rejected'
      f.undoRequests.push(req)
    })
    return req
  }

  async closeUndoRequest(id: string, status: 'done' | 'rejected'): Promise<void> {
    await this.write((f) => {
      const u = f.undoRequests.find((x) => x.id === id)
      if (u) u.status = status
    })
  }
}

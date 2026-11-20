import { join } from 'node:path'
import { readJson, writeJsonAtomic, Mutex } from '../storage/atomicJson'

/** What an AI may do with one site. New sites start at "read". */
export type AgentLevel = 'read' | 'prepare' | 'release'

export const LEVEL_RANK: Record<AgentLevel, number> = { read: 1, prepare: 2, release: 3 }

export const LEVEL_LABEL: Record<AgentLevel, string> = {
  read: 'Bare se',
  prepare: 'Se og klargjøre',
  release: 'Se, klargjøre og gi ut'
}

export interface AgentClient {
  /** Stable id derived from the client's reported name, e.g. "claude-code". */
  id: string
  /** Friendly name shown to the user, e.g. "Claude Code". */
  name: string
  status: 'approved' | 'denied'
  firstSeen: string
  lastSeen: string
}

export interface AgentAction {
  at: string
  clientName: string
  method: string
  siteId?: string
  siteName?: string
  ok: boolean
  /** Short Norwegian note (for example why a call was refused). */
  note?: string
}

export interface AgentSettings {
  /** Main switch for "AI-tilkobling". Off by default. */
  enabled: boolean
  /** Level per site id. Sites missing here are "read". */
  levels: Record<string, AgentLevel>
  clients: AgentClient[]
  /** Most recent actions, newest first (max 100). */
  recent: AgentAction[]
}

const DEFAULTS: AgentSettings = { enabled: false, levels: {}, clients: [], recent: [] }

/**
 * Settings for the AI connection (`agent.json`). Only the app's own settings screen changes
 * the switch, levels and clients. The API has no way to write them.
 */
export class AgentStore {
  private mutex = new Mutex()
  private cache: AgentSettings | null = null

  constructor(private readonly dataDir: string) {}

  private get file(): string {
    return join(this.dataDir, 'agent.json')
  }

  async get(): Promise<AgentSettings> {
    this.cache ??= { ...DEFAULTS, ...(await readJson<Partial<AgentSettings>>(this.file, {})) }
    return structuredClone(this.cache)
  }

  private async write(fn: (s: AgentSettings) => void): Promise<AgentSettings> {
    return this.mutex.run(async () => {
      const s = await this.get()
      fn(s)
      await writeJsonAtomic(this.file, s)
      this.cache = s
      return structuredClone(s)
    })
  }

  levelFor(s: AgentSettings, siteId: string): AgentLevel {
    return s.levels[siteId] ?? 'read'
  }

  setEnabled(enabled: boolean): Promise<AgentSettings> {
    return this.write((s) => {
      s.enabled = enabled
    })
  }

  setLevel(siteId: string, level: AgentLevel): Promise<AgentSettings> {
    if (!(level in LEVEL_RANK)) throw new Error('Invalid level')
    return this.write((s) => {
      s.levels[siteId] = level
    })
  }

  setClient(client: Omit<AgentClient, 'firstSeen' | 'lastSeen'>): Promise<AgentSettings> {
    return this.write((s) => {
      const now = new Date().toISOString()
      const cur = s.clients.find((c) => c.id === client.id)
      if (cur) Object.assign(cur, { name: client.name, status: client.status, lastSeen: now })
      else s.clients.push({ ...client, firstSeen: now, lastSeen: now })
    })
  }

  touchClient(id: string): Promise<AgentSettings> {
    return this.write((s) => {
      const c = s.clients.find((x) => x.id === id)
      if (c) c.lastSeen = new Date().toISOString()
    })
  }

  /** "Koble fra": the client must be approved again before it can do anything. */
  removeClient(id: string): Promise<AgentSettings> {
    return this.write((s) => {
      s.clients = s.clients.filter((c) => c.id !== id)
    })
  }

  addAction(a: AgentAction): Promise<AgentSettings> {
    return this.write((s) => {
      s.recent = [a, ...s.recent].slice(0, 100)
    })
  }
}

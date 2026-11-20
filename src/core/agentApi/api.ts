import { METHOD_LABEL } from './labels'
import { UserError, redact } from '../errors'
import type { Site } from '../types'
import { AgentStore, LEVEL_LABEL, LEVEL_RANK, type AgentLevel, type AgentSettings } from './store'

/** The client that makes a call, as reported by the bridge or the command line. */
export interface ClientInfo {
  /** Raw name from the client, e.g. "claude-code" (from MCP initialize) or "skyv-kommandolinje". */
  name: string
}

export interface CallContext {
  client: { id: string; name: string }
  /** The site the call is about (resolved from name or id), if any. */
  site?: Site
  level?: AgentLevel
}

export interface MethodDef {
  /** Minimum level needed on the site. "none" = no site involved (still needs the main switch and approval). */
  level: AgentLevel | 'none'
  /** True if the method needs a `site` parameter. */
  needsSite: boolean
  handler: (params: Record<string, unknown>, ctx: CallContext) => Promise<unknown>
}

export interface AgentApiDeps {
  store: AgentStore
  listSites: () => Promise<Site[]>
  /** Ask the user in the app whether a new client may connect. Resolves true if allowed. */
  approve: (clientName: string) => Promise<boolean>
  /** Write to the site's log, e.g. "Utført av AI (Claude Code): skyv_get_changes". */
  logToSite: (siteId: string, message: string) => Promise<void>
  /** Every secret Skyv knows (passwords, API key). Removed from all replies as a last line of defence. */
  knownSecrets: () => Promise<string[]>
  /** Max calls per client per minute. */
  rateLimitPerMinute?: number
  now?: () => number
}

export interface ApiError {
  code: 'disabled' | 'not-approved' | 'denied' | 'forbidden' | 'rate-limited' | 'not-found' | 'bad-request' | 'failed'
  message: string
  hint?: string
}

export type ApiResponse = { ok: true; result: unknown } | { ok: false; error: ApiError }

const KNOWN_CLIENTS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'claude-ai': 'Claude-appen',
  'claude-desktop': 'Claude-appen',
  claude: 'Claude',
  'skyv-kommandolinje': 'Skyv kommandolinje'
}

/** "claude-code" -> { id: "claude-code", name: "Claude Code" }. Unknown names are shown as given (shortened). */
export function identifyClient(info: ClientInfo): { id: string; name: string } {
  const raw = String(info?.name ?? '').trim().slice(0, 60) || 'ukjent'
  const id = raw.toLowerCase().replace(/[^a-z0-9æøå._-]+/g, '-')
  return { id, name: KNOWN_CLIENTS[id] ?? raw }
}

class Refused extends Error {
  constructor(readonly apiError: ApiError) {
    super(apiError.message)
  }
}

/** Replace every known secret in every string of a value (deep). */
export function scrubSecrets<T>(value: T, secrets: string[]): T {
  const list = secrets.filter((s) => s && s.length >= 4)
  if (list.length === 0) return value
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return redact(v, list)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return walk(value) as T
}

/**
 * The local API that AI clients (through the MCP bridge or the command line) talk to.
 * Every call goes through the same gate, in the main process:
 *  1. the main switch must be on;
 *  2. the client must be approved by the user (asked once, in the app);
 *  3. a simple rate limit per client;
 *  4. the site's level must allow the method.
 * There are no methods that change permissions, ignore rules or ignored findings.
 */
export class AgentApi {
  private methods = new Map<string, MethodDef>()
  private calls = new Map<string, number[]>()
  private pendingApprovals = new Map<string, Promise<boolean>>()

  constructor(private readonly deps: AgentApiDeps) {}

  register(name: string, def: MethodDef): void {
    this.methods.set(name, def)
  }

  get methodNames(): string[] {
    return [...this.methods.keys()]
  }

  private async resolveSite(ref: unknown): Promise<Site> {
    if (typeof ref !== 'string' || !ref.trim()) throw new Refused({ code: 'bad-request', message: 'Oppgi nettsiden (navn eller id) i "site".' })
    const sites = await this.deps.listSites()
    const r = ref.trim().toLowerCase()
    const site = sites.find((s) => s.id === ref) ?? sites.find((s) => s.name.toLowerCase() === r)
    if (!site) throw new Refused({ code: 'not-found', message: `Fant ingen nettside som heter "${ref}".`, hint: 'Bruk skyv_list_sites for å se navnene.' })
    return site
  }

  private async approveClient(client: { id: string; name: string }, settings: AgentSettings): Promise<void> {
    const known = settings.clients.find((c) => c.id === client.id)
    if (known?.status === 'approved') {
      await this.deps.store.touchClient(client.id)
      return
    }
    if (known?.status === 'denied') {
      throw new Refused({ code: 'denied', message: `Skyv har ikke gitt ${client.name} tilgang.`, hint: 'Brukeren kan endre dette under Innstillinger → AI-tilkobling i Skyv.' })
    }
    // Ask the user once; parallel calls from the same client share the question.
    let pending = this.pendingApprovals.get(client.id)
    if (!pending) {
      pending = this.deps.approve(client.name).finally(() => this.pendingApprovals.delete(client.id))
      this.pendingApprovals.set(client.id, pending)
    }
    const allowed = await pending
    await this.deps.store.setClient({ id: client.id, name: client.name, status: allowed ? 'approved' : 'denied' })
    if (!allowed) throw new Refused({ code: 'denied', message: `Brukeren ga ikke ${client.name} tilgang til Skyv.` })
  }

  private rateLimit(clientId: string): void {
    const limit = this.deps.rateLimitPerMinute ?? 60
    const now = this.deps.now?.() ?? Date.now()
    const recent = (this.calls.get(clientId) ?? []).filter((t) => now - t < 60_000)
    if (recent.length >= limit) {
      this.calls.set(clientId, recent)
      throw new Refused({ code: 'rate-limited', message: 'For mange forespørsler på kort tid.', hint: 'Vent et minutt og prøv igjen.' })
    }
    recent.push(now)
    this.calls.set(clientId, recent)
  }

  /** Handle one call. Never throws; always returns a response that is safe to send. */
  async call(clientInfo: ClientInfo, method: string, params: Record<string, unknown> = {}): Promise<ApiResponse> {
    const client = identifyClient(clientInfo)
    let site: Site | undefined
    let response: ApiResponse
    try {
      const settings = await this.deps.store.get()
      if (!settings.enabled) {
        throw new Refused({ code: 'disabled', message: 'AI-tilkobling er slått av i Skyv.', hint: 'Brukeren kan slå den på under Innstillinger → AI-tilkobling.' })
      }
      const def = this.methods.get(method)
      if (!def) throw new Refused({ code: 'not-found', message: `Ukjent funksjon: ${method}.` })
      if (params === null || typeof params !== 'object' || Array.isArray(params)) throw new Refused({ code: 'bad-request', message: 'Ugyldige parametere.' })
      await this.approveClient(client, settings)
      this.rateLimit(client.id)

      let level: AgentLevel | undefined
      if (def.needsSite) {
        site = await this.resolveSite(params.site)
        level = this.deps.store.levelFor(await this.deps.store.get(), site.id)
        if (def.level !== 'none' && LEVEL_RANK[level] < LEVEL_RANK[def.level]) {
          throw new Refused({
            code: 'forbidden',
            message: `Nettsiden "${site.name}" har nivået "${LEVEL_LABEL[level]}", som ikke tillater dette.`,
            hint: `Dette krever "${LEVEL_LABEL[def.level]}". Bare brukeren kan endre nivået, i Skyv under Innstillinger → AI-tilkobling.`
          })
        }
      }
      const result = await def.handler(params, { client, site, level })
      response = { ok: true, result }
    } catch (err) {
      if (err instanceof Refused) response = { ok: false, error: err.apiError }
      else if (err instanceof UserError) response = { ok: false, error: { code: 'failed', message: err.message, hint: err.hint } }
      else response = { ok: false, error: { code: 'failed', message: 'Noe uventet gikk galt i Skyv.', hint: 'Prøv igjen.' } }
    }

    // Last line of defence: no password or key may ever leave Skyv.
    response = scrubSecrets(response, await this.deps.knownSecrets().catch(() => []))

    const note = response.ok ? undefined : response.error.message
    await this.deps.store
      .addAction({ at: new Date().toISOString(), clientName: client.name, method, siteId: site?.id, siteName: site?.name, ok: response.ok, note })
      .catch(() => undefined)
    if (site) {
      await this.deps
        .logToSite(site.id, `Utført av AI (${client.name}): ${METHOD_LABEL[method] ?? method}${response.ok ? '' : ` (avvist: ${note})`}`)
        .catch(() => undefined)
    }
    return response
  }
}

import Anthropic from '@anthropic-ai/sdk'
import type { SiteService } from '../sites/siteService'
import type { SecretStore } from '../secrets/secretStore'
import type { AppSettingsStore } from '../appSettings'
import type { Workspaces } from './workspaces'
import type { ChecksService } from './checks'
import { changeKey } from '../manifest/changes'
import { buildAiPayload, payloadText, aiSummary, type ModelCall } from '../summary/aiSummary'
import { UserError } from '../errors'

export const API_KEY_SECRET = 'anthropic-api-key'
const MODEL = 'claude-opus-5-5'

/** Optional AI-written release notes, using the user's own Anthropic API key. */
export class SummaryService {
  constructor(
    private readonly sites: SiteService,
    private readonly workspaces: Workspaces,
    private readonly checks: ChecksService,
    private readonly secrets: SecretStore,
    private readonly settings: AppSettingsStore
  ) {}

  hasKey(): Promise<boolean> {
    return this.secrets.has(API_KEY_SECRET)
  }

  async setKey(key: string | null): Promise<void> {
    if (key === null || key.trim() === '') return this.secrets.delete(API_KEY_SECRET)
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim())) throw new UserError('Dette ser ikke ut som en API-nøkkel fra Anthropic.', 'Nøkkelen starter med sk-ant-. Du finner den i Anthropic Console.')
    await this.secrets.set(API_KEY_SECRET, key.trim())
  }

  /** Exactly what would be sent for these changes (shown before first use, and on request). */
  async preview(siteId: string, keys: string[]): Promise<string> {
    return payloadText(await this.payload(siteId, keys))
  }

  private async payload(siteId: string, keys: string[]) {
    const ws = await this.workspaces.get(siteId)
    const cs = ws.lastChangeSet ?? (await this.workspaces.scan(siteId))
    const wanted = new Set(keys)
    const changes = cs.changes.filter((c) => wanted.has(changeKey(c)))
    const { findings } = await this.checks.run(siteId, keys)
    const secretPaths = new Set(findings.filter((f) => ['secret', 'db-password', 'private-key', 'sensitive-file'].includes(f.check)).map((f) => f.path))
    return buildAiPayload(
      changes,
      async (c) => {
        const d = await ws.diff(c)
        return d.kind === 'text' ? d.diff : null
      },
      secretPaths
    )
  }

  async write(siteId: string, keys: string[]): Promise<string> {
    const s = await this.settings.get()
    if (!s.aiSummaries) throw new UserError('Sammendrag med AI er slått av.', 'Slå det på i innstillingene for Skyv.')
    if (!s.aiConsentGiven) throw new UserError('Du må se hva som sendes, før første gang.')
    const apiKey = await this.secrets.get(API_KEY_SECRET)
    if (!apiKey) throw new UserError('API-nøkkelen mangler.', 'Legg den inn i innstillingene for Skyv.')
    await this.sites.require(siteId)
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 })
    const call: ModelCall = async (system, user) => {
      try {
        const res = await client.beta.messages.create({
          model: MODEL,
          max_tokens: 1024,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' },
          system,
          messages: [{ role: 'user', content: user }]
        })
        if (res.stop_reason === 'refusal') throw new UserError('AI-en ville ikke skrive et sammendrag for disse endringene.', 'Bruk det vanlige sammendraget.')
        const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
        if (!text.trim()) throw new UserError('AI-en svarte uten tekst.', 'Prøv igjen, eller bruk det vanlige sammendraget.')
        return text
      } catch (err) {
        if (err instanceof UserError) throw err
        if (err instanceof Anthropic.AuthenticationError) throw new UserError('API-nøkkelen ble ikke godtatt av Anthropic.', 'Sjekk nøkkelen i innstillingene for Skyv.')
        if (err instanceof Anthropic.PermissionDeniedError) throw new UserError('API-nøkkelen har ikke tilgang til denne tjenesten.', 'Sjekk kontoen din i Anthropic Console.')
        if (err instanceof Anthropic.RateLimitError) throw new UserError('Anthropic tar ikke imot flere forespørsler akkurat nå.', 'Vent litt og prøv igjen.')
        if (err instanceof Anthropic.APIConnectionError) throw new UserError('Fikk ikke kontakt med Anthropic.', 'Sjekk internettforbindelsen.')
        if (err instanceof Anthropic.APIError) throw new UserError('Noe gikk galt hos Anthropic.', 'Prøv igjen om litt, eller bruk det vanlige sammendraget.')
        throw new UserError('Klarte ikke å lage sammendrag med AI.', 'Bruk det vanlige sammendraget.')
      }
    }
    return aiSummary(await this.payload(siteId, keys), call)
  }
}

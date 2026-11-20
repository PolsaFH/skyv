import type { PasswordChange } from '../api'
import type { SecretStore } from '../secrets/secretStore'
import type { Site, SiteInput, SiteView } from '../types'
import { SiteStore } from './siteStore'
import { UserError } from '../errors'

/** Combines site config and stored passwords. The renderer only ever sees `SiteView`. */
export class SiteService {
  /** Supplies the number of pending changes per site (from the last scan). */
  pendingCount: (id: string) => number = () => 0
  /** Supplies the number of unhandled server deviations per site (from the last server check). */
  deviationCount: (id: string) => number = () => 0

  constructor(
    readonly store: SiteStore,
    private readonly secrets: SecretStore
  ) {}

  static passwordKey(id: string): string {
    return `site-${id}`
  }

  private async view(site: Site): Promise<SiteView> {
    return {
      ...site,
      hasPassword: await this.secrets.has(SiteService.passwordKey(site.id)),
      pendingCount: this.pendingCount(site.id),
      deviationCount: this.deviationCount(site.id)
    }
  }

  async list(): Promise<SiteView[]> {
    const sites = await this.store.list()
    return Promise.all(sites.map((s) => this.view(s)))
  }

  async require(id: string): Promise<Site> {
    const site = await this.store.get(id)
    if (!site) throw new UserError('Fant ikke nettsiden.')
    return site
  }

  async create(input: SiteInput, password?: PasswordChange): Promise<SiteView> {
    const site = await this.store.create(input)
    await this.applyPassword(site.id, password)
    return this.view(site)
  }

  async update(id: string, input: SiteInput, password?: PasswordChange): Promise<SiteView> {
    const site = await this.store.update(id, input)
    await this.applyPassword(id, password)
    return this.view(site)
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id)
    await this.secrets.delete(SiteService.passwordKey(id))
  }

  async getPassword(id: string): Promise<string | undefined> {
    return this.secrets.get(SiteService.passwordKey(id))
  }

  private async applyPassword(id: string, password: PasswordChange): Promise<void> {
    if (password === undefined) return
    if (password === null) await this.secrets.delete(SiteService.passwordKey(id))
    else await this.secrets.set(SiteService.passwordKey(id), password)
  }
}

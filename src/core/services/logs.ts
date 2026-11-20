import { SiteLog } from '../log/siteLog'
import type { SiteService } from '../sites/siteService'

/** One action log per site; the site's password is always scrubbed from what is written. */
export class Logs {
  constructor(private readonly sites: SiteService) {}

  for(siteId: string): SiteLog {
    return new SiteLog(this.sites.store.siteDir(siteId), async () => [await this.sites.getPassword(siteId).catch(() => undefined)])
  }
}

import { join } from 'node:path'
import { mkdir, rename } from 'node:fs/promises'
import { SiteStore } from '../../src/core/sites/siteStore'
import { SiteService } from '../../src/core/sites/siteService'
import { SecretStore } from '../../src/core/secrets/secretStore'
import { Workspaces } from '../../src/core/services/workspaces'
import { ChecksService } from '../../src/core/services/checks'
import { ReleaseService } from '../../src/core/services/releases'
import { ServerCheckService } from '../../src/core/services/serverCheck'
import { Logs } from '../../src/core/services/logs'
import { AgentStore } from '../../src/core/agentApi/store'
import { fakeEncryptor } from './tmp'

/** The app's service stack without Electron (in-process scanning, a test Trash folder). */
export function createServices(dataDir: string) {
  const secrets = new SecretStore(join(dataDir, 'secrets'), fakeEncryptor)
  const sites = new SiteService(new SiteStore(dataDir), secrets)
  const workspaces = new Workspaces(sites)
  sites.pendingCount = (id) => workspaces.pendingCount(id)
  const checks = new ChecksService(sites, workspaces)
  const logs = new Logs(sites)
  const releases = new ReleaseService(sites, workspaces, checks, () => undefined, logs)
  const trashDir = join(dataDir, '..', 'Papirkurv')
  const serverCheck = new ServerCheckService(sites, workspaces, releases, logs, () => undefined, async (abs) => {
    await mkdir(trashDir, { recursive: true })
    await rename(abs, join(trashDir, `${Date.now()}-${abs.split('/').pop()}`))
  })
  sites.deviationCount = (id) => serverCheck.deviationCount(id)
  releases.deviationPaths = async (id) => ((await serverCheck.last(id))?.deviations ?? []).map((d) => d.path)
  const store = new AgentStore(dataDir)
  return { secrets, sites, workspaces, checks, logs, releases, serverCheck, store, trashDir }
}

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { AgentApi } from '../../src/core/agentApi/api'
import { registerReadMethods } from '../../src/core/agentApi/methods'
import { registerReadTools, type ScreenshotFn } from '../../src/core/agentApi/readTools'
import { registerPrepareTools } from '../../src/core/agentApi/prepareTools'
import { startSocketServer } from '../../src/core/agentApi/socket'
import { createBridge } from '../../src/bridge/bridge'
import { startStaticServer } from '../../src/core/preview/staticServer'
import type { AgentLevel } from '../../src/core/agentApi/store'
import { startFtpServer } from './ftpServer'
import { createServices } from './services'
import { makeTmpDir } from './tmp'

export const BASE_FILES: Record<string, string> = {
  'index.html': '<html><head><title>Kafé</title><link rel="stylesheet" href="stil.css"></head><body><h1>Hei</h1></body></html>\n',
  'om.html': '<html><head><title>Om</title></head><body><h1>Om oss</h1></body></html>\n',
  'stil.css': 'body{}\n'
}

/**
 * Full stack without Electron: services, agent API, socket, skyv-mcp bridge, and an MCP client
 * (as "claude-code"), against the local FTP test server and a static web server for the live site.
 */
export async function agentStack(opts: { level?: AgentLevel; screenshot?: ScreenshotFn; files?: Record<string, string> } = {}) {
  const cleanups: Array<() => Promise<void>> = []
  const t = await makeTmpDir()
  cleanups.push(t.cleanup)
  const dataDir = join(t.dir, 'data')
  const local = join(t.dir, 'lokal')
  const web = join(t.dir, 'server', 'www')
  for (const root of [local, web]) {
    for (const [p, c] of Object.entries(opts.files ?? BASE_FILES)) {
      await mkdir(join(root, p, '..'), { recursive: true })
      await writeFile(join(root, p), c)
    }
  }
  const ftp = await startFtpServer(join(t.dir, 'server'))
  cleanups.push(() => ftp.close())
  const live = await startStaticServer(web)
  cleanups.push(() => live.stop())

  const s = createServices(dataDir)
  const site = await s.sites.create(
    { name: 'kafe.no', localPath: local, protocol: 'ftp', host: '127.0.0.1', port: ftp.port, username: ftp.username, remoteRoot: '/www', url: live.url, startingPoint: { choice: 'assume-synced', chosenAt: '', applied: false } },
    ftp.password
  )
  await s.workspaces.scan(site.id) // starting point
  await s.store.setEnabled(true)
  if (opts.level) await s.store.setLevel(site.id, opts.level)

  const events: Array<{ type: string; siteId: string }> = []
  const api = new AgentApi({
    store: s.store,
    listSites: () => s.sites.store.list(),
    approve: async () => true,
    logToSite: (id, msg) => s.logs.for(id).add('ai', msg),
    knownSecrets: async () => [ftp.password]
  })
  registerReadMethods(api, s)
  registerReadTools(api, s, opts.screenshot)
  registerPrepareTools(api, s, {
    draftsChanged: (siteId) => events.push({ type: 'drafts', siteId }),
    undoRequested: (siteId) => events.push({ type: 'undo', siteId })
  })

  const socketPath = join(t.dir, 's.sock')
  const server = await startSocketServer(socketPath, (req) => api.call(req.client, req.method, req.params ?? {}))
  cleanups.push(() => server.close())
  const bridge = createBridge({ socketPath, launchApp: async () => undefined, launchWaitMs: 200 })
  cleanups.push(async () => bridge.close())
  const [c, srv] = InMemoryTransport.createLinkedPair()
  await bridge.server.connect(srv)
  const mcp = new Client({ name: 'claude-code', version: '1' })
  await mcp.connect(c)
  cleanups.push(() => mcp.close())

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await mcp.callTool({ name, arguments: { site: 'kafe.no', ...args } })
    const text = (r.content as Array<{ type: string; text?: string }>).find((x) => x.type === 'text')?.text ?? ''
    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(text)
    } catch {
      /* error text */
    }
    return { isError: Boolean(r.isError), text, data: data as Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  return {
    api,
    socketPath,
    s,
    site,
    mcp,
    call,
    local,
    web,
    dataDir,
    events,
    cleanup: async () => {
      for (const f of cleanups.reverse()) await f().catch(() => undefined)
    }
  }
}

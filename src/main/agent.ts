import { app, dialog, ipcMain, nativeImage, Notification, type BrowserWindow } from 'electron'
import { AgentApi } from '../core/agentApi/api'
import { AgentStore, LEVEL_RANK, type AgentLevel } from '../core/agentApi/store'
import { registerReadMethods, type AgentServices } from '../core/agentApi/methods'
import { registerReadTools, type ScreenshotFn } from '../core/agentApi/readTools'
import { registerPrepareTools, validateDraft, draftStoreFor } from '../core/agentApi/prepareTools'
import { changeKey } from '../core/manifest/changes'
import { setupInfo, cliScript, installCli, type ToolPaths } from '../core/agentApi/setup'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promises as fsp } from 'node:fs'
import type { PreviewService } from './preview'
import { startSocketServer, socketPathFor, type SocketServer } from '../core/agentApi/socket'
import type { SecretStore } from '../core/secrets/secretStore'
import type { Logs } from '../core/services/logs'
import { IPC } from '../core/api'
import { toSerializedError } from '../core/errors'
import { API_KEY_SECRET } from '../core/services/summary'

interface Deps {
  dataDir: string
  services: Omit<AgentServices, 'store' | 'logs'>
  secrets: SecretStore
  logs: Logs
  showMain: () => BrowserWindow
  preview: PreviewService
  openSite: (siteId: string) => void
  broadcast: (channel: string, payload?: unknown) => void
}

/**
 * The AI connection in the app: the agent API on a Unix socket, the "Tillat?" question for new
 * clients, and the settings that only the app (never the API) can change.
 */
export async function startAgent(d: Deps): Promise<{ api: AgentApi; store: AgentStore; server: SocketServer | null }> {
  const store = new AgentStore(d.dataDir)
  const services: AgentServices = { ...d.services, logs: d.logs, store }

  const api = new AgentApi({
    store,
    listSites: () => services.sites.store.list(),
    approve: async (clientName) => {
      const win = d.showMain()
      app.focus({ steal: true })
      const res = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Tillat', 'Ikke tillat'],
        defaultId: 1,
        cancelId: 1,
        message: `${clientName} vil koble til Skyv. Tillat?`,
        detail:
          'AI-en kan da gjøre det nivået du har valgt for hver nettside tillater (som standard "Bare se"). Den ser aldri passord eller nøkler, og kan aldri omgå sjekkene. Du kan koble den fra under Innstillinger → AI-tilkobling.'
      })
      return res.response === 0
    },
    logToSite: (siteId, message) => d.logs.for(siteId).add('ai', message),
    knownSecrets: async () => {
      const out: string[] = []
      for (const s of await services.sites.store.list()) {
        const pw = await services.sites.getPassword(s.id).catch(() => undefined)
        if (pw) out.push(pw)
      }
      const key = await d.secrets.get(API_KEY_SECRET).catch(() => undefined)
      if (key) out.push(key)
      return out
    }
  })
  registerReadMethods(api, services)
  registerReadTools(api, services, screenshotFor(d.preview))

  const notify = (title: string, body: string, siteId: string) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body, actions: [{ type: 'button', text: 'Se gjennom' }] })
    n.on('click', () => d.openSite(siteId))
    n.on('action', () => d.openSite(siteId))
    n.show()
  }
  registerPrepareTools(api, services, {
    draftsChanged: (siteId, draft) => {
      d.broadcast(IPC.evDraftsUpdated, { siteId })
      if (draft) {
        void services.sites.store.get(siteId).then((site) => {
          const n = draft.files.length
          notify(`${draft.createdBy} har klargjort en utgivelse`, `${n === 1 ? '1 fil' : `${n} filer`} i ${site?.name ?? 'nettsiden'} er klare til å gis ut.`, siteId)
        })
      }
    },
    undoRequested: (siteId, req) => {
      d.broadcast(IPC.evDraftsUpdated, { siteId })
      void services.sites.store.get(siteId).then((site) => notify(`${req.requestedBy} ber deg angre en utgivelse`, `Gjelder ${site?.name ?? 'nettsiden'}. Se gjennom i Skyv.`, siteId))
    }
  })

  let server: SocketServer | null = null
  try {
    // SKYV_SOCKET lets developers and tests choose the socket path (the bridge honours it too).
    server = await startSocketServer(process.env.SKYV_SOCKET || socketPathFor(d.dataDir), async (req) => {
      const res = await api.call(req.client, req.method, req.params ?? {})
      d.broadcast(IPC.evAgentUpdated, await store.get())
      return res
    })
  } catch (err) {
    console.error('[skyv] agent socket could not start:', err instanceof Error ? err.message : err)
  }

  const handle = (channel: string, fn: (...args: unknown[]) => Promise<unknown>) =>
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        const value = await fn(...args)
        d.broadcast(IPC.evAgentUpdated, await store.get())
        return { ok: true, value }
      } catch (err) {
        return { ok: false, error: toSerializedError(err) }
      }
    })
  handle(IPC.draftsList, async (siteId) => {
    const ds = draftStoreFor(services, String(siteId))
    return { drafts: await ds.open(), undoRequests: await ds.openUndoRequests() }
  })
  handle(IPC.draftsValidate, async (siteId, draftId) => {
    const site = await services.sites.require(String(siteId))
    const draft = await draftStoreFor(services, site.id).get(String(draftId))
    if (!draft) throw new Error('Draft not found')
    const v = await validateDraft(services, site, draft)
    return { ok: v.ok, problems: v.problems, stale: v.stale, keys: v.changes.map(changeKey) }
  })
  handle(IPC.draftsDiscard, async (siteId, draftId) => {
    await draftStoreFor(services, String(siteId)).update(String(draftId), { status: 'discarded' })
    await d.logs.for(String(siteId)).add('ai', 'Utkastet fra AI ble forkastet av brukeren.').catch(() => undefined)
    d.broadcast(IPC.evDraftsUpdated, { siteId })
  })
  handle(IPC.draftsMarkReleased, async (siteId, draftId, releaseId) => {
    const ds = draftStoreFor(services, String(siteId))
    const draft = await ds.get(String(draftId))
    await ds.update(String(draftId), { status: 'released', releaseId: String(releaseId) })
    // Keep the "Skrevet av AI" mark when the user gave it out with the AI's note unchanged.
    const rel = (await services.releases.list(String(siteId))).find((r) => r.id === releaseId)
    if (draft && rel && rel.note === draft.note) await services.releases.setNote(String(siteId), rel.id, draft.note, draft.createdBy).catch(() => undefined)
    d.broadcast(IPC.evDraftsUpdated, { siteId })
  })
  handle(IPC.draftsCloseUndo, async (siteId, requestId, status) => {
    await draftStoreFor(services, String(siteId)).closeUndoRequest(String(requestId), status === 'done' ? 'done' : 'rejected')
    d.broadcast(IPC.evDraftsUpdated, { siteId })
  })
  handle(IPC.agentSetupInfo, async () => {
    const paths = toolPaths()
    const info = setupInfo(paths, homedir())
    const cliPath = join(homedir(), '.local', 'bin', 'skyv')
    const installed = await fsp.readFile(cliPath, 'utf8').then((t) => t.includes('command line for Skyv'), () => false)
    return {
      claudeCodeCommand: info.claudeCodeCommand,
      claudeDesktopJson: info.claudeDesktopJson,
      claudeDesktopConfigPath: info.claudeDesktopConfigPath,
      cliInstalledAt: installed ? cliPath : null,
      packaged: app.isPackaged
    }
  })
  handle(IPC.agentInstallCli, async () => {
    const r = await installCli(join(homedir(), '.local', 'bin'), cliScript(toolPaths()))
    return r
  })
  handle(IPC.agentGet, () => store.get())
  handle(IPC.agentSetEnabled, (v) => store.setEnabled(v === true))
  handle(IPC.agentSetLevel, (siteId, level) => {
    if (typeof siteId !== 'string' || typeof level !== 'string' || !(level in LEVEL_RANK)) throw new Error('Invalid level')
    return store.setLevel(siteId, level as AgentLevel)
  })
  handle(IPC.agentRemoveClient, (id) => {
    if (typeof id !== 'string') throw new Error('Invalid id')
    return store.removeClient(id)
  })

  return { api, store, server }
}

/** Max size of screenshots sent to an AI: wide enough to read, small enough to send. */
const SHOT_WIDTH = { desktop: 1000, mobile: 390 } as const
const SHOT_MAX_HEIGHT = 2400

/** Screenshots for skyv_screenshot, scaled down and cropped to a reasonable size, as JPEG. */
function screenshotFor(preview: PreviewService): ScreenshotFn {
  return async (siteId, path, source, width) => {
    const shot = await preview.capture(siteId, path, source, width === 'mobile' ? 390 : 1280)
    let img = nativeImage.createFromDataURL(shot.dataUrl)
    const size = img.getSize()
    const targetW = SHOT_WIDTH[width]
    if (size.width > targetW) img = img.resize({ width: targetW, quality: 'good' })
    const s2 = img.getSize()
    if (s2.height > SHOT_MAX_HEIGHT) img = img.crop({ x: 0, y: 0, width: s2.width, height: SHOT_MAX_HEIGHT })
    const final = img.getSize()
    return { mimeType: 'image/jpeg', data: img.toJPEG(75).toString('base64'), width: final.width, height: final.height }
  }
}

/** Where the bridge and command line live, in the installed app and in development. */
function toolPaths(): ToolPaths {
  if (app.isPackaged) {
    const unpacked = join(process.resourcesPath, 'app.asar.unpacked', 'out', 'bridge')
    return {
      runtime: process.execPath,
      bridgeScript: join(unpacked, 'skyv-mcp.cjs'),
      cliScript: join(unpacked, 'skyv.cjs'),
      bridgeLauncher: join(process.resourcesPath, 'bin', 'skyv-mcp')
    }
  }
  const out = join(app.getAppPath(), 'out', 'bridge')
  return { runtime: process.execPath, bridgeScript: join(out, 'skyv-mcp.cjs'), cliScript: join(out, 'skyv.cjs') }
}

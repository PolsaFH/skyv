import { ipcMain, dialog, shell, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { IPC, type ConnectionRequest, type IpcResult, type PasswordChange } from '../core/api'
import type { RemoteSessions } from '../core/remote'
import { detectRemoteRoot, readLocalTopLevel } from '../core/remote/detectRoot'
import { normalizeRemotePath } from '../core/remote/paths'
import { normalizeHost } from '../core/sites/siteStore'
import { UserError } from '../core/errors'
import { getPhp } from '../core/services/phpService'
import type { Workspaces } from '../core/services/workspaces'
import type { ReleaseService } from '../core/services/releases'
import type { ChecksService } from '../core/services/checks'
import type { PreviewService } from './preview'
import type { SummaryService } from '../core/services/summary'
import type { Logs } from '../core/services/logs'
import type { ServerCheckService } from '../core/services/serverCheck'
import { exportSites, importSites, parseExport } from '../core/transfer/exportImport'
import { writeFileAtomic } from '../core/storage/atomicJson'
import { instructionsState, removeInstructions, writeInstructions } from '../core/sites/aiInstructions'
import type { Change } from '../core/manifest/changes'
import type { StartingPointChoice } from '../core/types'
import type { ProgressEvent } from '../core/api'
import { toSerializedError, redact } from '../core/errors'
import type { SiteService } from '../core/sites/siteService'
import type { SiteInput } from '../core/types'

interface Deps {
  sites: SiteService
  remoteSessions: RemoteSessions
  workspaces: Workspaces
  releases: ReleaseService
  checks: ChecksService
  preview: PreviewService
  summary: SummaryService
  logs: Logs
  serverCheck: ServerCheckService
  getWindow: () => BrowserWindow | null
  /** Called after a site is added, changed or removed (to restart background watching). */
  onSitesChanged: () => void
}

/** Register a handler that always returns an IpcResult; errors are made safe for display. */
function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T>): void {
  ipcMain.handle(channel, async (_e, ...args: unknown[]): Promise<IpcResult<T>> => {
    try {
      return { ok: true, value: await fn(...(args as A)) }
    } catch (err) {
      // Log only the error type and a redacted message; never arguments (they may contain passwords).
      // Arguments are never logged (they may contain passwords); the message is redacted.
      console.error(`[skyv] ${channel} failed:`, err instanceof Error ? `${err.name}: ${redact(err.message)}` : typeof err)
      return { ok: false, error: toSerializedError(err) }
    }
  })
}

const FIELD_LABEL = {
  name: 'navn',
  localPath: 'mappe på Macen',
  protocol: 'tilkobling',
  host: 'vert',
  port: 'port',
  username: 'brukernavn',
  remoteRoot: 'mappe på serveren',
  url: 'nettadresse',
  ignoreRules: 'ignorer-regler'
} as const

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function asPassword(v: unknown): PasswordChange {
  if (v === undefined || v === null) return v
  if (typeof v !== 'string') throw new Error('Invalid password value')
  return v
}

export function registerIpc({ sites, remoteSessions, workspaces, releases, checks, preview, summary, logs, serverCheck, getWindow, onSitesChanged }: Deps): void {
  const ACTIONS = ['reupload', 'delete-local', 'let-go', 'fetch-server', 'overwrite-mine', 'fetch-to-mac', 'dismiss']
  handle(IPC.serverCheckLast, async (siteId: string) => (await serverCheck.last(siteId)) ?? null)
  handle(IPC.serverCheckRun, async (siteId: string) => serverCheck.run(siteId))
  handle(IPC.serverCheckResolve, async (siteId: string, path: unknown, action: unknown) => {
    if (!isString(path) || !isString(action) || !ACTIONS.includes(action)) throw new Error('Invalid arguments')
    return serverCheck.resolve(siteId, path, action as never)
  })
  handle(IPC.summaryHasKey, async () => summary.hasKey())
  handle(IPC.summarySetKey, async (key: unknown) => {
    if (key !== null && !isString(key)) throw new Error('Invalid key')
    await summary.setKey(key)
  })
  handle(IPC.summaryPreview, async (siteId: string, keys: unknown) => summary.preview(siteId, strings(keys) ?? []))
  handle(IPC.summaryWrite, async (siteId: string, keys: unknown) => summary.write(siteId, strings(keys) ?? []))
  handle(IPC.logsList, async (siteId: string) => {
    await sites.require(siteId)
    return logs.for(siteId).list()
  })
  handle(IPC.releaseSetNote, async (siteId: string, releaseId: string, note: unknown) => {
    if (!isString(note)) throw new Error('Invalid note')
    return releases.setNote(siteId, releaseId, note)
  })
  handle(IPC.transferExport, async () => {
    const win = getWindow()
    const opts = { title: 'Eksporter nettsider', defaultPath: 'skyv-nettsider.json', filters: [{ name: 'Skyv-oppsett', extensions: ['json'] }] }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    const all = await sites.store.list()
    await writeFileAtomic(res.filePath, JSON.stringify(exportSites(all), null, 2) + '\n', 0o644)
    for (const s of all) await logs.for(s.id).add('export', 'Oppsettet ble eksportert (uten passord).').catch(() => undefined)
    return all.length
  })
  handle(IPC.transferImport, async () => {
    const win = getWindow()
    const opts = { title: 'Importer nettsider', properties: ['openFile' as const], filters: [{ name: 'Skyv-oppsett', extensions: ['json'] }] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    const file = parseExport(await fs.readFile(res.filePaths[0], 'utf8'))
    const result = await importSites(sites.store, file)
    for (const s of await sites.store.list()) {
      if (result.imported.includes(s.name)) await logs.for(s.id).add('import', 'Nettsiden ble importert fra en eksportfil. Passord må legges inn på nytt.').catch(() => undefined)
    }
    onSitesChanged()
    return result
  })
  const which = (v: unknown): 'live' | 'local' => {
    if (v !== 'live' && v !== 'local') throw new Error('Invalid target')
    return v
  }
  handle(IPC.previewInfo, async (siteId: string) => preview.info(siteId))
  handle(IPC.previewPages, async (siteId: string) => preview.pages(siteId))
  handle(IPC.previewCapture, async (siteId: string, path: string, w: unknown, width: unknown) => {
    if (!isString(path)) throw new Error('Invalid path')
    return preview.capture(siteId, path, which(w), Number(width) || 1280)
  })
  handle(IPC.previewOpen, async (siteId: string, path: string, w: unknown) => {
    if (!isString(path)) throw new Error('Invalid path')
    return preview.open(siteId, path, which(w))
  })
  const sendProgress = (e: ProgressEvent) => getWindow()?.webContents.send(IPC.progress, e)

  const strings = (v: unknown): string[] | undefined => {
    if (v === undefined || v === null) return undefined
    if (!Array.isArray(v) || !v.every(isString)) throw new Error('Invalid list')
    return v
  }
  handle(IPC.releaseCheck, async (siteId: string, keys: unknown) => releases.check(siteId, strings(keys) ?? []))
  handle(IPC.releaseConflictDiff, async (siteId: string, path: string) => {
    if (!isString(path)) throw new Error('Invalid path')
    return releases.conflictDiff(siteId, path)
  })
  handle(IPC.releaseFileHistory, async (siteId: string, path: string) => {
    if (!isString(siteId) || !isString(path)) throw new Error('Invalid path')
    return releases.fileHistory(siteId, path)
  })
  handle(IPC.releasePublish, async (siteId: string, keys: unknown, note?: unknown, ack?: unknown) => {
    if (!isString(siteId)) throw new Error('Invalid id')
    return releases.publish(siteId, strings(keys) ?? [], isString(note) ? note.slice(0, 5000) : undefined, ack === true)
  })
  handle(IPC.checksRun, async (siteId: string, keys: unknown) => checks.run(siteId, strings(keys) ?? []))
  handle(IPC.checksIgnore, async (siteId: string, key: unknown) => {
    if (!isString(key) || key.length > 300) throw new Error('Invalid key')
    await checks.ignored(siteId).add(key)
    await logs.for(siteId).add('finding-ignored', `Et funn ble ignorert (${key.split(':')[0]} i ${key.split(':')[1] || 'utgivelsen'}).`).catch(() => undefined)
  })
  handle(IPC.checksClear, async (siteId: string) => {
    await checks.ignored(siteId).clear()
    await logs.for(siteId).add('findings-reset', 'Alle ignorerte funn vises igjen.').catch(() => undefined)
  })
  handle(IPC.releaseRetry, async (siteId: string, releaseId: string) => releases.retry(siteId, releaseId))
  handle(IPC.releaseRecheck, async (siteId: string, releaseId: string) => releases.recheck(siteId, releaseId))
  handle(IPC.releaseList, async (siteId: string) => releases.list(siteId))
  handle(IPC.releasePlanUndo, async (siteId: string, releaseId: string, paths?: unknown) => releases.planUndo(siteId, releaseId, strings(paths)))
  handle(IPC.releaseUndo, async (siteId: string, releaseId: string, paths?: unknown) => releases.undo(siteId, releaseId, strings(paths)))
  handle(IPC.releaseInterrupted, async () => releases.interrupted())
  handle(IPC.releaseDismiss, async (siteId: string) => releases.dismissInterrupted(siteId))

  const validChange = (c: unknown): Change => {
    const ch = c as Change
    if (!ch || typeof ch.path !== 'string' || !['added', 'modified', 'deleted', 'renamed'].includes(ch.kind)) throw new Error('Invalid change')
    return ch
  }

  handle(IPC.changesScan, async (siteId: string) => {
    if (!isString(siteId)) throw new Error('Invalid id')
    return workspaces.scan(siteId, (progress) => sendProgress({ siteId, kind: 'scan', progress }))
  })
  handle(IPC.changesLast, async (siteId: string) => (await workspaces.get(siteId)).lastChangeSet)
  handle(IPC.changesDiff, async (siteId: string, change: unknown, fromServer?: boolean) => {
    const ws = await workspaces.get(siteId)
    const c = validChange(change)
    if (!fromServer) return ws.diff(c)
    const site = await sites.require(siteId)
    const client = await workspaces.connect(site)
    try {
      return await ws.diff(c, (remotePath) => workspaces.fetchRemoteFile(client, remotePath))
    } finally {
      await client.close()
    }
  })
  handle(IPC.changesSetStartingPoint, async (siteId: string, choice: StartingPointChoice) => {
    if (!['assume-synced', 'compare', 'upload-all'].includes(choice)) throw new Error('Invalid choice')
    const ws = await workspaces.get(siteId)
    const existing = await ws.manifest.load()
    if (existing) throw new UserError('Utgangspunktet er allerede valgt for denne nettsiden.')
    await sites.store.update(siteId, { startingPoint: { choice, chosenAt: new Date().toISOString(), applied: false } })
    const label = { 'assume-synced': 'Serveren er lik mappen (start herfra)', compare: 'Sammenlign med serveren', 'upload-all': 'Last opp alt' }[choice]
    await logs.for(siteId).add('starting-point', `Utgangspunkt valgt: ${label}.`).catch(() => undefined)
    return workspaces.scan(siteId, (progress) => sendProgress({ siteId, kind: 'scan', progress }))
  })
  handle(IPC.changesCompare, async (siteId: string, deep: boolean) => {
    const site = await sites.require(siteId)
    const ws = await workspaces.get(siteId)
    if (await ws.manifest.load()) throw new UserError('Nettsiden er allerede sammenlignet med serveren.')
    await workspaces.scan(siteId)
    const client = await workspaces.connect(site)
    try {
      const res = await ws.compareWithServer(client, {
        deep: Boolean(deep),
        onProgress: (p) => sendProgress({ siteId, kind: 'compare', ...p })
      })
      await sites.store.update(siteId, {
        startingPoint: { choice: 'compare', chosenAt: site.startingPoint?.chosenAt ?? new Date().toISOString(), applied: true }
      })
      await workspaces.scan(siteId)
      await logs
        .for(siteId)
        .add('compare', `Sammenlignet med serveren (${deep ? 'grundig' : 'rask'} sjekk): ${res.same.length + res.sameSizeUnverified.length} like, ${res.different.length} forskjellige, ${res.onlyLocal.length} bare på Macen, ${res.onlyRemote.length} bare på serveren.`, res.different)
        .catch(() => undefined)
      return {
        same: res.same.length,
        sameSizeUnverified: res.sameSizeUnverified.length,
        different: res.different,
        onlyLocal: res.onlyLocal.length,
        onlyRemote: res.onlyRemote,
        deep: Boolean(deep)
      }
    } finally {
      await client.close()
    }
  })

  handle(IPC.remoteOpen, async (req: ConnectionRequest) => {
    if (!req || typeof req !== 'object') throw new Error('Invalid request')
    let password = typeof req.password === 'string' && req.password !== '' ? req.password : undefined
    let sftpHostKey: string | undefined
    if (req.siteId) {
      const site = await sites.require(req.siteId)
      if (password === undefined) password = await sites.getPassword(req.siteId)
      // Only trust the remembered host key if the server is unchanged.
      if (normalizeHost(req.host) === site.host && Number(req.port) === site.port) sftpHostKey = site.sftpHostKey
    }
    if (password === undefined) throw new UserError('Skriv inn passordet.')
    const { id, info } = await remoteSessions.open({
      protocol: req.protocol,
      host: normalizeHost(req.host),
      port: Number(req.port),
      username: String(req.username ?? '').trim(),
      password,
      acceptSelfSigned: Boolean(req.acceptSelfSigned),
      sftpHostKey
    })
    return { sessionId: id, homeDir: info.homeDir, sftpHostKey: info.sftpHostKey, reliableTimes: info.reliableTimes }
  })
  handle(IPC.remoteList, async (sessionId: string, path: string) => {
    if (!isString(sessionId) || !isString(path)) throw new Error('Invalid arguments')
    const entries = await remoteSessions.run(sessionId, (c) => c.list(normalizeRemotePath(path)))
    return entries.sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name, 'nb'))
  })
  handle(IPC.remoteDetectRoot, async (sessionId: string, localPath: string, siteName?: string) => {
    if (!isString(sessionId) || !isString(localPath)) throw new Error('Invalid arguments')
    const local = await readLocalTopLevel(localPath).catch(() => {
      throw new UserError('Klarte ikke å lese mappen på Macen.')
    })
    return remoteSessions.run(sessionId, (c, info) =>
      detectRemoteRoot(c, local, { startDir: info.homeDir, siteName: isString(siteName) ? siteName : undefined })
    )
  })
  handle(IPC.remoteClose, async (sessionId: string) => {
    if (isString(sessionId)) await remoteSessions.close(sessionId)
  })

  handle(IPC.sitesList, () => sites.list())
  handle(IPC.sitesCreate, async (input: SiteInput, password?: unknown) => {
    const v = await sites.create(input, asPassword(password))
    await logs.for(v.id).add('site-created', `Nettsiden ble lagt til (${v.protocol.toUpperCase()} til ${v.host || 'ingen server'}, mappe ${v.remoteRoot}).`).catch(() => undefined)
    onSitesChanged()
    return v
  })
  handle(IPC.sitesUpdate, async (id: string, input: SiteInput, password?: unknown) => {
    if (!isString(id)) throw new Error('Invalid id')
    const before = await sites.require(id)
    const v = await sites.update(id, input, asPassword(password))
    const changed = (['name', 'localPath', 'protocol', 'host', 'port', 'username', 'remoteRoot', 'url', 'ignoreRules'] as const).filter((k) => before[k] !== v[k])
    const settingsChanged = JSON.stringify(before.settings) !== JSON.stringify(v.settings)
    const what = [...changed.map((k) => FIELD_LABEL[k]), ...(settingsChanged ? ['innstillinger'] : []), ...(typeof password === 'string' ? ['passord'] : [])]
    if (what.length > 0) await logs.for(id).add('site-updated', `Endret ${what.join(', ')}.`).catch(() => undefined)
    onSitesChanged()
    return v
  })
  handle(IPC.sitesAiInstructions, async (id: string, action: unknown) => {
    if (!isString(id)) throw new Error('Invalid id')
    const site = await sites.require(id)
    if (!site.localPath) throw new UserError('Nettsiden har ingen mappe på Macen.')
    if (action === 'write') {
      await writeInstructions(site.localPath, site.name)
      await logs.for(id).add('ai', 'La til Skyv-instruksjoner for AI i CLAUDE.md.').catch(() => undefined)
    } else if (action === 'remove') {
      await removeInstructions(site.localPath, (abs) => shell.trashItem(abs))
      await logs.for(id).add('ai', 'Fjernet Skyv-instruksjonene fra CLAUDE.md.').catch(() => undefined)
    }
    return instructionsState(site.localPath)
  })
  handle(IPC.sitesRemove, async (id: string) => {
    if (!isString(id)) throw new Error('Invalid id')
    await sites.remove(id)
    workspaces.forget(id)
    onSitesChanged()
  })

  handle(IPC.phpInfo, async () => {
    const php = await getPhp(true)
    return php ? { found: true, version: php.version, path: php.path } : { found: false }
  })

  handle(IPC.chooseFolder, async () => {
    const win = getWindow()
    const opts = { title: 'Velg mappen med nettsiden', properties: ['openDirectory' as const, 'createDirectory' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  handle(IPC.isFolder, async (path: string) => {
    if (!isString(path)) return false
    try {
      return (await fs.stat(path)).isDirectory()
    } catch {
      return false
    }
  })

  handle(IPC.showSiteFolder, async (id: string) => {
    const site = await sites.require(id)
    if (site.localPath) shell.showItemInFolder(site.localPath)
  })
  handle(IPC.openSiteUrl, async (id: string) => {
    const site = await sites.require(id)
    if (/^https?:\/\//i.test(site.url)) await shell.openExternal(site.url)
  })
}

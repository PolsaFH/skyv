import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type IpcResult, type SkyvApi } from '../core/api'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (res.ok) return res.value
  // contextBridge only carries message across, so attach the hint to it in a parseable way.
  const err = new Error(JSON.stringify(res.error))
  err.name = 'SkyvError'
  throw err
}

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: SkyvApi = {
  sites: {
    list: () => call(IPC.sitesList),
    create: (input, password) => call(IPC.sitesCreate, input, password),
    update: (id, input, password) => call(IPC.sitesUpdate, id, input, password),
    remove: (id) => call(IPC.sitesRemove, id),
    aiInstructions: (id, action) => call(IPC.sitesAiInstructions, id, action)
  },
  remote: {
    open: (req) => call(IPC.remoteOpen, req),
    list: (sessionId, path) => call(IPC.remoteList, sessionId, path),
    detectRoot: (sessionId, localPath, siteName) => call(IPC.remoteDetectRoot, sessionId, localPath, siteName),
    close: (sessionId) => call(IPC.remoteClose, sessionId)
  },
  changes: {
    scan: (siteId) => call(IPC.changesScan, siteId),
    last: (siteId) => call(IPC.changesLast, siteId),
    diff: (siteId, change, fromServer) => call(IPC.changesDiff, siteId, change, fromServer),
    setStartingPoint: (siteId, choice) => call(IPC.changesSetStartingPoint, siteId, choice),
    compare: (siteId, deep) => call(IPC.changesCompare, siteId, deep),
    onProgress: (cb) => {
      const listener = (_e: unknown, payload: Parameters<typeof cb>[0]) => cb(payload)
      ipcRenderer.on(IPC.progress, listener)
      return () => ipcRenderer.removeListener(IPC.progress, listener)
    }
  },
  releases: {
    check: (siteId, keys) => call(IPC.releaseCheck, siteId, keys),
    conflictDiff: (siteId, path) => call(IPC.releaseConflictDiff, siteId, path),
    fileHistory: (siteId, path) => call(IPC.releaseFileHistory, siteId, path),
    publish: (siteId, keys, note, acknowledgeBlocking) => call(IPC.releasePublish, siteId, keys, note, acknowledgeBlocking),
    retry: (siteId, releaseId) => call(IPC.releaseRetry, siteId, releaseId),
    recheck: (siteId, releaseId) => call(IPC.releaseRecheck, siteId, releaseId),
    list: (siteId) => call(IPC.releaseList, siteId),
    planUndo: (siteId, releaseId, paths) => call(IPC.releasePlanUndo, siteId, releaseId, paths),
    undo: (siteId, releaseId, paths) => call(IPC.releaseUndo, siteId, releaseId, paths),
    interrupted: () => call(IPC.releaseInterrupted),
    dismissInterrupted: (siteId) => call(IPC.releaseDismiss, siteId),
    setNote: (siteId, releaseId, note) => call(IPC.releaseSetNote, siteId, releaseId, note)
  },
  checks: {
    run: (siteId, keys) => call(IPC.checksRun, siteId, keys),
    ignore: (siteId, key) => call(IPC.checksIgnore, siteId, key),
    clearIgnored: (siteId) => call(IPC.checksClear, siteId)
  },
  serverCheck: {
    last: (siteId) => call(IPC.serverCheckLast, siteId),
    run: (siteId) => call(IPC.serverCheckRun, siteId),
    resolve: (siteId, path, action) => call(IPC.serverCheckResolve, siteId, path, action),
    onUpdated: (cb) => on(IPC.evServerCheckUpdated, cb)
  },
  drafts: {
    list: (siteId) => call(IPC.draftsList, siteId),
    validate: (siteId, draftId) => call(IPC.draftsValidate, siteId, draftId),
    discard: (siteId, draftId) => call(IPC.draftsDiscard, siteId, draftId),
    markReleased: (siteId, draftId, releaseId) => call(IPC.draftsMarkReleased, siteId, draftId, releaseId),
    closeUndoRequest: (siteId, requestId, status) => call(IPC.draftsCloseUndo, siteId, requestId, status),
    onUpdated: (cb) => on(IPC.evDraftsUpdated, cb)
  },
  agent: {
    getSettings: () => call(IPC.agentGet),
    setEnabled: (enabled) => call(IPC.agentSetEnabled, enabled),
    setLevel: (siteId, level) => call(IPC.agentSetLevel, siteId, level),
    removeClient: (clientId) => call(IPC.agentRemoveClient, clientId),
    setupInfo: () => call(IPC.agentSetupInfo),
    installCli: () => call(IPC.agentInstallCli),
    onUpdated: (cb) => on(IPC.evAgentUpdated, cb)
  },
  summary: {
    hasKey: () => call(IPC.summaryHasKey),
    setKey: (key) => call(IPC.summarySetKey, key),
    preview: (siteId, keys) => call(IPC.summaryPreview, siteId, keys),
    write: (siteId, keys) => call(IPC.summaryWrite, siteId, keys)
  },
  logs: {
    list: (siteId) => call(IPC.logsList, siteId)
  },
  transfer: {
    exportSites: () => call(IPC.transferExport),
    importSites: () => call(IPC.transferImport)
  },
  preview: {
    info: (siteId) => call(IPC.previewInfo, siteId),
    pages: (siteId) => call(IPC.previewPages, siteId),
    capture: (siteId, path, which, width) => call(IPC.previewCapture, siteId, path, which, width),
    open: (siteId, path, which) => call(IPC.previewOpen, siteId, path, which)
  },
  app: {
    getSettings: () => call(IPC.appGetSettings),
    setSettings: (patch) => call(IPC.appSetSettings, patch),
    setSelectedSite: (siteId) => ipcRenderer.send(IPC.appSelectedSite, siteId),
    openMain: (siteId) => call(IPC.appOpenMain, siteId),
    quickRelease: (siteId, acceptWarnings) => call(IPC.appQuickRelease, siteId, acceptWarnings),
    onChangesUpdated: (cb) => on(IPC.evChangesUpdated, cb),
    onSelectSite: (cb) => on(IPC.evSelectSite, cb),
    onOpenAppSettings: (cb) => on(IPC.evOpenAppSettings, () => cb())
  },
  system: {
    phpInfo: () => call(IPC.phpInfo)
  },
  files: {
    chooseFolder: () => call(IPC.chooseFolder),
    isFolder: (path) => call(IPC.isFolder, path),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  shell: {
    showSiteFolder: (id) => call(IPC.showSiteFolder, id),
    openSiteUrl: (id) => call(IPC.openSiteUrl, id)
  }
}

contextBridge.exposeInMainWorld('skyv', api)

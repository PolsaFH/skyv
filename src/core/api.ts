// Typed contract between preload (window.skyv) and renderer. Pure types.
import type { SerializedError } from './errors'
import type { Protocol, SiteInput, SiteView } from './types'
import type { RemoteEntry } from './remote/types'
import type { RootCandidate } from './remote/detectRoot'
import type { ChangeSet, DiffResult } from './workspace'
import type { Change } from './manifest/changes'
import type { ScanProgress } from './scan/scanner'
import type { StartingPointChoice } from './types'

import type { Release, ReleaseProgress } from './release/types'
import type { UndoStep } from './release/undo'
import type { Conflict } from './release/conflicts'
import type { FileHistoryEntry, FileChangeView } from './release/history'
import type { DependencyInfo } from './deps/dependencies'
import type { Finding } from './checks/types'
import type { AppSettings } from './appSettings'
import type { LogEntry } from './log/siteLog'
import type { ImportResult } from './transfer/exportImport'
import type { ServerCheckResult } from './serverCheck/serverCheck'
import type { Deviation } from './serverCheck/deviations'
import type { DeviationAction } from './serverCheck/resolve'
import type { AgentSettings, AgentLevel } from './agentApi/store'
import type { Draft, UndoRequest } from './agentApi/drafts'

export type { FileHistoryEntry, FileChangeView }
export type { ChangeSet, DiffResult, Change, ScanProgress, Release, ReleaseProgress, UndoStep, Conflict, DependencyInfo, Finding, AppSettings, LogEntry, ImportResult, ServerCheckResult, Deviation, DeviationAction, AgentSettings, AgentLevel, Draft, UndoRequest }

export type QuickReleaseResult =
  | { status: 'released'; release: Release }
  | { status: 'nothing' }
  | { status: 'warnings'; count: number; examples: string[] }
  | { status: 'needs-review'; reason: 'starting-point' | 'blocking' | 'conflicts' | 'busy' | 'deviations'; message: string }

export interface InterruptedRelease {
  siteId: string
  siteName: string
  releaseId: string
  kind: 'release' | 'undo'
  startedAt: string
}

export interface CompareSummary {
  same: number
  sameSizeUnverified: number
  different: string[]
  onlyLocal: number
  onlyRemote: string[]
  deep: boolean
}

export type ProgressEvent =
  | { siteId: string; kind: 'scan'; progress: ScanProgress }
  | { siteId: string; kind: 'compare'; phase: 'listing' | 'checking'; done: number; total: number }
  | { siteId: string; kind: 'release'; progress: ReleaseProgress }

/** Connection details from a form. Password may be omitted when `siteId` has one stored. */
export interface ConnectionRequest {
  siteId?: string
  protocol: Protocol
  host: string
  port: number
  username: string
  password?: string
  acceptSelfSigned?: boolean
}

export interface RemoteSessionInfo {
  sessionId: string
  homeDir: string
  sftpHostKey?: string
  reliableTimes: boolean
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: SerializedError }

/**
 * Password handling in create/update:
 *  - undefined: leave unchanged
 *  - string: store (encrypted in the keychain)
 *  - null: remove stored password
 */
export type PasswordChange = string | null | undefined

export interface SkyvApi {
  sites: {
    list(): Promise<SiteView[]>
    create(input: SiteInput, password?: PasswordChange): Promise<SiteView>
    update(id: string, input: SiteInput, password?: PasswordChange): Promise<SiteView>
    remove(id: string): Promise<void>
    /** Skyv section in CLAUDE.md in the site folder: read the state, write/update it, or remove it. */
    aiInstructions(id: string, action: 'status' | 'write' | 'remove'): Promise<'none' | 'present'>
  }
  remote: {
    /** Connect and keep the connection open for browsing. Doubles as "Test tilkobling". */
    open(req: ConnectionRequest): Promise<RemoteSessionInfo>
    list(sessionId: string, path: string): Promise<RemoteEntry[]>
    detectRoot(sessionId: string, localPath: string, siteName?: string): Promise<RootCandidate[]>
    close(sessionId: string): Promise<void>
  }
  changes: {
    scan(siteId: string): Promise<ChangeSet>
    last(siteId: string): Promise<ChangeSet | null>
    diff(siteId: string, change: Change, fromServer?: boolean): Promise<DiffResult>
    setStartingPoint(siteId: string, choice: StartingPointChoice): Promise<ChangeSet>
    compare(siteId: string, deep: boolean): Promise<CompareSummary>
    onProgress(cb: (e: ProgressEvent) => void): () => void
  }
  releases: {
    /** Check the server for files changed by someone else since the last release. */
    check(siteId: string, keys: string[]): Promise<Conflict[]>
    /** The server's current version of a file compared with the one on the Mac. */
    conflictDiff(siteId: string, path: string): Promise<DiffResult>
    /** Releases that touched one file, newest first, with stored line differences. */
    fileHistory(siteId: string, path: string): Promise<FileHistoryEntry[]>
    /** Give out the selected changes, identified by `changeKey`. */
    /** `acknowledgeBlocking`: the user ticked "Jeg vet hva jeg gjør, gi ut likevel". */
    publish(siteId: string, keys: string[], note?: string, acknowledgeBlocking?: boolean): Promise<Release>
    retry(siteId: string, releaseId: string): Promise<Release>
    /** Check the live site again after a release. */
    recheck(siteId: string, releaseId: string): Promise<Release>
    list(siteId: string): Promise<Release[]>
    planUndo(siteId: string, releaseId: string, paths?: string[]): Promise<UndoStep[]>
    undo(siteId: string, releaseId: string, paths?: string[]): Promise<Release>
    interrupted(): Promise<InterruptedRelease[]>
    setNote(siteId: string, releaseId: string, note: string): Promise<Release>
    dismissInterrupted(siteId: string): Promise<void>
  }
  checks: {
    /** Run the pre-release checks on the selected changes. Ignored findings are left out. */
    run(siteId: string, keys: string[]): Promise<{ findings: Finding[]; ignoredCount: number }>
    ignore(siteId: string, key: string): Promise<void>
    clearIgnored(siteId: string): Promise<void>
  }
  serverCheck: {
    /** Last stored result (undefined if never checked). */
    last(siteId: string): Promise<ServerCheckResult | null>
    /** "Sjekk serveren". */
    run(siteId: string): Promise<ServerCheckResult>
    /** The user's choice for one deviation. "reupload" also gives the file out right away. */
    resolve(siteId: string, path: string, action: DeviationAction): Promise<{ message: string; release?: Release; result?: ServerCheckResult }>
    onUpdated(cb: (e: { siteId: string; result: ServerCheckResult | null }) => void): () => void
  }
  drafts: {
    /** Open drafts and undo requests from AI clients for a site. */
    list(siteId: string): Promise<{ drafts: Draft[]; undoRequests: UndoRequest[] }>
    /** Check a draft before the user gives it out (same stops as for the AI). */
    validate(siteId: string, draftId: string): Promise<{ ok: boolean; problems: string[]; stale: boolean; keys: string[] }>
    discard(siteId: string, draftId: string): Promise<void>
    markReleased(siteId: string, draftId: string, releaseId: string): Promise<void>
    closeUndoRequest(siteId: string, requestId: string, status: 'done' | 'rejected'): Promise<void>
    onUpdated(cb: (e: { siteId: string }) => void): () => void
  }
  agent: {
    getSettings(): Promise<AgentSettings>
    setEnabled(enabled: boolean): Promise<AgentSettings>
    setLevel(siteId: string, level: AgentLevel): Promise<AgentSettings>
    /** "Koble fra": the client must be approved again. */
    removeClient(clientId: string): Promise<AgentSettings>
    /** Ready-made setup for Claude Code and the Claude app, and whether `skyv` is installed. */
    setupInfo(): Promise<{
      claudeCodeCommand: string
      claudeDesktopJson: string
      claudeDesktopConfigPath: string
      cliInstalledAt: string | null
      packaged: boolean
    }>
    /** Put the `skyv` command in ~/.local/bin. */
    installCli(): Promise<{ path: string; action: 'created' | 'updated'; onPath: boolean }>
    onUpdated(cb: (s: AgentSettings) => void): () => void
  }
  summary: {
    hasKey(): Promise<boolean>
    /** Store the Anthropic API key in the keychain (null removes it). The key is never sent back. */
    setKey(key: string | null): Promise<void>
    /** Exactly what would be sent to the AI for these changes. */
    preview(siteId: string, keys: string[]): Promise<string>
    write(siteId: string, keys: string[]): Promise<string>
  }
  logs: {
    list(siteId: string): Promise<LogEntry[]>
  }
  transfer: {
    /** Save all site setups (without passwords) to a file the user picks. Returns the number saved, or null if cancelled. */
    exportSites(): Promise<number | null>
    importSites(): Promise<ImportResult | null>
  }
  preview: {
    info(siteId: string): Promise<{ local: 'static' | 'php' | 'unavailable'; localReason?: string; live: boolean; liveReason?: string }>
    /** Pages worth comparing for the current changes. */
    pages(siteId: string): Promise<Array<{ path: string; reason: 'changed' | 'uses-changed' | 'front-page'; via?: string }>>
    capture(siteId: string, path: string, which: 'live' | 'local', width: number): Promise<{ dataUrl: string; height: number }>
    /** Open the page in the default browser (local preview or the real site). */
    open(siteId: string, path: string, which: 'live' | 'local'): Promise<void>
  }
  app: {
    getSettings(): Promise<AppSettings>
    setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
    /** Tell the main process which site is shown (for the menu bar count). */
    setSelectedSite(siteId: string | null): void
    /** From the menu bar popover: open the main window, optionally on a site. */
    openMain(siteId?: string): Promise<void>
    quickRelease(siteId: string, acceptWarnings: boolean): Promise<QuickReleaseResult>
    onChangesUpdated(cb: (e: { siteId: string; changeSet: ChangeSet }) => void): () => void
    onSelectSite(cb: (siteId: string) => void): () => void
    onOpenAppSettings(cb: () => void): () => void
  }
  system: {
    /** Whether PHP was found on the Mac (used for syntax checks and local preview). */
    phpInfo(): Promise<{ found: boolean; version?: string; path?: string }>
  }
  files: {
    chooseFolder(): Promise<string | null>
    isFolder(path: string): Promise<boolean>
    /** Resolve a dropped File to its absolute path. */
    pathForFile(file: File): string
  }
  shell: {
    showSiteFolder(id: string): Promise<void>
    openSiteUrl(id: string): Promise<void>
  }
}

/** Channel names, kept in one place. */
export const IPC = {
  sitesList: 'sites:list',
  sitesCreate: 'sites:create',
  sitesUpdate: 'sites:update',
  sitesRemove: 'sites:remove',
  sitesAiInstructions: 'sites:aiInstructions',
  remoteOpen: 'remote:open',
  remoteList: 'remote:list',
  remoteDetectRoot: 'remote:detectRoot',
  remoteClose: 'remote:close',
  phpInfo: 'system:phpInfo',
  serverCheckLast: 'serverCheck:last',
  serverCheckRun: 'serverCheck:run',
  serverCheckResolve: 'serverCheck:resolve',
  evServerCheckUpdated: 'ev:serverCheckUpdated',
  draftsList: 'drafts:list',
  draftsValidate: 'drafts:validate',
  draftsDiscard: 'drafts:discard',
  draftsMarkReleased: 'drafts:markReleased',
  draftsCloseUndo: 'drafts:closeUndo',
  evDraftsUpdated: 'ev:draftsUpdated',
  agentGet: 'agent:get',
  agentSetEnabled: 'agent:setEnabled',
  agentSetLevel: 'agent:setLevel',
  agentRemoveClient: 'agent:removeClient',
  agentSetupInfo: 'agent:setupInfo',
  agentInstallCli: 'agent:installCli',
  evAgentUpdated: 'ev:agentUpdated',
  summaryHasKey: 'summary:hasKey',
  summarySetKey: 'summary:setKey',
  summaryPreview: 'summary:preview',
  summaryWrite: 'summary:write',
  logsList: 'logs:list',
  transferExport: 'transfer:export',
  transferImport: 'transfer:import',
  releaseSetNote: 'releases:setNote',
  previewInfo: 'preview:info',
  previewPages: 'preview:pages',
  previewCapture: 'preview:capture',
  previewOpen: 'preview:open',
  appGetSettings: 'app:getSettings',
  appSetSettings: 'app:setSettings',
  appSelectedSite: 'app:selectedSite',
  appOpenMain: 'app:openMain',
  appQuickRelease: 'app:quickRelease',
  evChangesUpdated: 'ev:changesUpdated',
  evSelectSite: 'ev:selectSite',
  evOpenAppSettings: 'ev:openAppSettings',
  changesScan: 'changes:scan',
  changesLast: 'changes:last',
  changesDiff: 'changes:diff',
  changesSetStartingPoint: 'changes:setStartingPoint',
  changesCompare: 'changes:compare',
  progress: 'progress',
  checksRun: 'checks:run',
  checksIgnore: 'checks:ignore',
  checksClear: 'checks:clearIgnored',
  releaseCheck: 'releases:check',
  releaseConflictDiff: 'releases:conflictDiff',
  releaseFileHistory: 'releases:fileHistory',
  releasePublish: 'releases:publish',
  releaseRetry: 'releases:retry',
  releaseRecheck: 'releases:recheck',
  releaseList: 'releases:list',
  releasePlanUndo: 'releases:planUndo',
  releaseUndo: 'releases:undo',
  releaseInterrupted: 'releases:interrupted',
  releaseDismiss: 'releases:dismissInterrupted',
  chooseFolder: 'files:chooseFolder',
  isFolder: 'files:isFolder',
  showSiteFolder: 'shell:showSiteFolder',
  openSiteUrl: 'shell:openSiteUrl'
} as const

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly hint?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

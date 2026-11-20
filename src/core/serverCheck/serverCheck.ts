import { join } from 'node:path'
import { readJson, writeJsonAtomic, Mutex } from '../storage/atomicJson'
import { listRemoteTree } from '../remote/listTree'
import type { RemoteClient, ConnectInfo } from '../remote/types'
import type { SiteWorkspace } from '../workspace'
import { createIgnoreMatcher } from '../scan/ignoreRules'
import { buildUsedByIndex } from '../deps/usedBy'
import { isTextPath } from '../files/fileTypes'
import { findDeviations, type Deviation } from './deviations'
import { UserError } from '../errors'

export interface ServerCheckResult {
  checkedAt: string
  /** True when the server reports exact modification times (MLSD / SFTP). */
  reliableTimes: boolean
  remoteFileCount: number
  folderCount: number
  /** Folders that could not be listed (nothing below them is reported as missing). */
  unlistedFolders: string[]
  deviations: Deviation[]
  durationMs: number
}

interface StoredFile {
  last?: ServerCheckResult
  /** Server-only files the user chose to leave alone ("La være"). */
  dismissed: string[]
}

/** Last server check and the user's "leave it" choices, per site (`server-check.json`). */
export class ServerCheckStore {
  private mutex = new Mutex()

  constructor(private readonly siteDir: string) {}

  private get file(): string {
    return join(this.siteDir, 'server-check.json')
  }

  private read(): Promise<StoredFile> {
    return readJson<StoredFile>(this.file, { dismissed: [] })
  }

  async last(): Promise<ServerCheckResult | undefined> {
    return (await this.read()).last
  }

  async dismissed(): Promise<Set<string>> {
    return new Set((await this.read()).dismissed)
  }

  async save(result: ServerCheckResult): Promise<void> {
    await this.mutex.run(async () => writeJsonAtomic(this.file, { ...(await this.read()), last: result }))
  }

  async dismiss(path: string): Promise<void> {
    await this.mutex.run(async () => {
      const cur = await this.read()
      if (!cur.dismissed.includes(path)) cur.dismissed.push(path)
      await writeJsonAtomic(this.file, cur)
    })
  }

  /** Remove one handled deviation from the stored result, so the list updates without a new check. */
  async resolved(path: string): Promise<void> {
    await this.mutex.run(async () => {
      const cur = await this.read()
      if (cur.last) cur.last = { ...cur.last, deviations: cur.last.deviations.filter((d) => d.path !== path) }
      await writeJsonAtomic(this.file, cur)
    })
  }
}

/**
 * Check the server: list the remote root once (one connection, one listing per folder),
 * then compare with the manifest and the Mac. Nothing is changed anywhere.
 */
export async function runServerCheck(
  workspace: SiteWorkspace,
  remoteRoot: string,
  client: RemoteClient,
  info: Pick<ConnectInfo, 'reliableTimes'>,
  store: ServerCheckStore
): Promise<ServerCheckResult> {
  const started = Date.now()
  const manifest = await workspace.manifest.load()
  if (!manifest) throw new UserError('Velg utgangspunkt for nettsiden før serveren kan sjekkes.')
  if (workspace.scannedPaths.length === 0) await workspace.scan()
  const ignore = createIgnoreMatcher(await workspace.ignoreOptions())

  const unlistedFolders: string[] = []
  let truncated = false
  let folders = 0
  const remote = await listRemoteTree(client, remoteRoot, {
    ignore,
    maxFolders: 20000,
    onFolderError: (rel) => unlistedFolders.push(rel),
    onTruncated: () => (truncated = true),
    onProgress: (f) => (folders = f)
  })
  if (truncated) throw new UserError('Serveren har for mange mapper til at Skyv kan sjekke den.', 'Velg en mappe lenger ned på serveren i innstillingene.')

  const localPaths = new Set(workspace.scannedPaths)
  const usedBy = await buildUsedByIndex(
    workspace.scannedPaths.filter(isTextPath),
    (p) => workspace.readText(p),
    [...Object.keys(manifest.files), ...remote.keys()]
  )
  const deviations = findDeviations({
    manifest,
    remote,
    localPaths,
    ignore,
    reliableTimes: info.reliableTimes,
    dismissed: await store.dismissed(),
    unlistedFolders,
    usedBy
  })
  const result: ServerCheckResult = {
    checkedAt: new Date().toISOString(),
    reliableTimes: info.reliableTimes,
    remoteFileCount: remote.size,
    folderCount: folders,
    unlistedFolders,
    deviations,
    durationMs: Date.now() - started
  }
  await store.save(result)
  return result
}

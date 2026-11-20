import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import type { Site, StartingPointChoice } from './types'
import { createIgnoreMatcher, type IgnoreOptions } from './scan/ignoreRules'
import { scanFolder, readSkyvignore, hashFile, type HashCache, type ScannedFile, type ScanProgress, type ScanWarning } from './scan/scanner'
import { ManifestStore, emptyManifest, type Manifest } from './manifest/manifest'
import { detectChanges, type Change } from './manifest/changes'
import { PublishedCopies } from './manifest/publishedCopies'
import { manifestFromLocal, compareWithRemote, type CompareResult } from './manifest/startingPoint'
import { listRemoteTree } from './remote/listTree'
import { joinRemote } from './remote/paths'
import type { RemoteClient } from './remote/types'
import { readJson, writeJsonAtomic } from './storage/atomicJson'
import { textDiff, type TextDiff } from './diff/textDiff'
import { imageMime, isImagePath, looksBinary, MAX_TEXT_COPY_BYTES } from './files/fileTypes'
import { UserError } from './errors'
import { analyzeDependencies, type DependencyInfo } from './deps/dependencies'

export interface ScanOutput {
  files: ScannedFile[]
  cache: HashCache
  warnings: ScanWarning[]
  ignoredCount: number
}

/** Scanning can run in-process (tests) or in a worker thread (app). */
export type ScanFn = (root: string, ignore: IgnoreOptions, cache: HashCache, onProgress?: (p: ScanProgress) => void) => Promise<ScanOutput>

export const inProcessScan: ScanFn = async (root, ignore, cache, onProgress) => {
  const res = await scanFolder(root, { ignore: createIgnoreMatcher(ignore), cache, onProgress })
  return { files: [...res.files.values()], cache: res.cache, warnings: res.warnings, ignoredCount: res.ignoredCount }
}

export interface ChangeSet {
  siteId: string
  scannedAt: string
  fileCount: number
  ignoredCount: number
  changes: Change[]
  warnings: ScanWarning[]
  /** No starting point recorded yet; the user must choose one before anything can be given out. */
  needsStartingPoint: boolean
  /** The user chose "compare with server" and it has not been done yet. */
  needsCompare: boolean
  /** Latest time a file was given out or the starting point was set. */
  lastPublishedAt?: string
  /** New files that changed files need, and references that will break. */
  deps: DependencyInfo
  /** For changed files: the work session (burst of edits) they came from, if known. */
  sessions?: Record<string, { id: string; endedAt: string }>
}

export type DiffResult =
  | { kind: 'text'; diff: TextDiff; oldMissing: boolean; newMissing: boolean }
  | { kind: 'image'; before?: string; after?: string; beforeMissing: boolean }
  | { kind: 'binary'; size: number }
  | { kind: 'too-large'; size: number }

export class SiteWorkspace {
  readonly manifest: ManifestStore
  readonly copies: PublishedCopies
  private lastFiles: Map<string, ScannedFile> | null = null
  private last: ChangeSet | null = null

  constructor(
    private site: Site,
    private readonly siteDir: string,
    private readonly scanFn: ScanFn = inProcessScan
  ) {
    this.manifest = new ManifestStore(siteDir)
    this.copies = new PublishedCopies(join(siteDir, 'published'))
  }

  setSite(site: Site): void {
    this.site = site
  }

  get lastChangeSet(): ChangeSet | null {
    return this.last
  }

  /** Paths of all files found by the last scan. */
  get scannedPaths(): string[] {
    return this.lastFiles ? [...this.lastFiles.keys()] : []
  }

  /** Read a site file as text (null if missing or larger than 2 MB). */
  async readText(rel: string): Promise<string | null> {
    try {
      const abs = this.localPath(rel)
      const st = await fs.stat(abs)
      if (!st.isFile() || st.size > MAX_TEXT_COPY_BYTES * 2) return null
      return await fs.readFile(abs, 'utf8')
    } catch {
      return null
    }
  }

  async ignoreOptions(): Promise<IgnoreOptions> {
    return {
      siteRules: this.site.ignoreRules,
      skyvignore: await readSkyvignore(this.site.localPath),
      ignoreSourceMaps: this.site.settings.ignoreSourceMaps
    }
  }

  private get cacheFile(): string {
    return join(this.siteDir, 'hashcache.json')
  }

  /** Resolve a relative path to an absolute local path, refusing anything outside the site folder. */
  localPath(rel: string): string {
    if (rel.split('/').some((p) => p === '..') || rel.startsWith('/')) throw new UserError('Ugyldig filsti.')
    return join(this.site.localPath, rel)
  }

  async scan(onProgress?: (p: ScanProgress) => void): Promise<ChangeSet> {
    if (!this.site.localPath) throw new UserError('Nettsiden har ingen mappe på Macen.')
    try {
      const st = await fs.stat(this.site.localPath)
      if (!st.isDirectory()) throw new Error('not dir')
    } catch {
      throw new UserError('Fant ikke mappen på Macen.', `Sjekk at ${this.site.localPath} fortsatt finnes, eller velg mappen på nytt i innstillingene.`)
    }
    const ignoreOpts = await this.ignoreOptions()
    const cache = await readJson<HashCache>(this.cacheFile, {})
    const out = await this.scanFn(this.site.localPath, ignoreOpts, cache, onProgress)
    await writeJsonAtomic(this.cacheFile, out.cache)
    const files = new Map(out.files.map((f) => [f.path, f]))
    this.lastFiles = files

    let manifest = await this.manifest.load()
    const sp = this.site.startingPoint
    if (!manifest && sp && !sp.applied && sp.choice !== 'compare') {
      manifest = await this.applyLocalStartingPoint(sp.choice, files)
    }

    const ignore = createIgnoreMatcher(ignoreOpts)
    const changes = manifest ? detectChanges(files, manifest, ignore) : []
    const deps = manifest ? await this.dependencies(changes, files, manifest) : { neededBy: {}, missing: [], caseMismatch: [], ignored: [] }
    this.last = {
      deps,
      siteId: this.site.id,
      scannedAt: new Date().toISOString(),
      fileCount: files.size,
      ignoredCount: out.ignoredCount,
      changes,
      warnings: out.warnings,
      needsStartingPoint: !manifest && (!sp || (sp.choice !== 'compare' && !sp.applied)),
      needsCompare: !manifest && sp?.choice === 'compare',
      lastPublishedAt: manifest ? latestPublished(manifest) : undefined
    }
    return this.last
  }

  /** Record "start here" or "upload everything". Returns the new manifest. */
  async applyLocalStartingPoint(choice: Exclude<StartingPointChoice, 'compare'>, files?: Map<string, ScannedFile>): Promise<Manifest> {
    const f = files ?? this.lastFiles
    if (!f) throw new Error('Scan first')
    const manifest = choice === 'assume-synced' ? manifestFromLocal(f) : emptyManifest()
    if (choice === 'assume-synced') {
      for (const file of f.values()) {
        await this.copies.putFile(file.hash, file.path, this.localPath(file.path), file.size).catch(() => undefined)
      }
    }
    await this.manifest.save(manifest)
    return manifest
  }

  /**
   * "Sammenlign med serveren": list the remote root and compare. With `deep`, files with the same size
   * are downloaded to a temp folder and hashed. Nothing is changed on the server.
   */
  async compareWithServer(
    remote: RemoteClient,
    opts: { deep: boolean; onProgress?: (msg: { phase: 'listing' | 'checking'; done: number; total: number }) => void; signal?: AbortSignal }
  ): Promise<CompareResult> {
    if (!this.lastFiles) await this.scan()
    const files = this.lastFiles!
    const ignore = createIgnoreMatcher(await this.ignoreOptions())
    const remoteFiles = await listRemoteTree(remote, this.site.remoteRoot, {
      ignore,
      signal: opts.signal,
      onProgress: (folders, found) => opts.onProgress?.({ phase: 'listing', done: folders, total: found })
    })

    let tmp: string | null = null
    let i = 0
    const remoteHash = opts.deep
      ? async (path: string) => {
          if (opts.signal?.aborted) throw new Error('aborted')
          tmp ??= await fs.mkdtemp(join(tmpdir(), 'skyv-compare-'))
          const dest = join(tmp, `${i++}-${randomBytes(4).toString('hex')}.skyvtmp`)
          try {
            await remote.download(joinRemote(this.site.remoteRoot, path), dest)
            return await hashFile(dest)
          } catch {
            return null
          } finally {
            await fs.rm(dest, { force: true })
          }
        }
      : undefined

    try {
      const result = await compareWithRemote(files, remoteFiles, {
        remoteHash,
        onProgress: (done, total) => opts.onProgress?.({ phase: 'checking', done, total })
      })
      // Same content on both sides: the local text file is a correct copy of what is live.
      for (const path of [...result.same, ...result.sameSizeUnverified]) {
        const f = files.get(path)
        if (f) await this.copies.putFile(f.hash, f.path, this.localPath(f.path), f.size).catch(() => undefined)
      }
      await this.manifest.save(result.manifest)
      return result
    } finally {
      if (tmp) await fs.rm(tmp, { recursive: true, force: true })
    }
  }

  /**
   * Show what changed in one file. Text: line diff against the copy from the last release.
   * Images: data URLs. If the old version is not kept locally, `fetchOld` can get it from the server.
   */
  async diff(change: Change, fetchOld?: (remotePath: string) => Promise<Buffer | null>): Promise<DiffResult> {
    const newRel = change.kind === 'deleted' ? null : change.path
    const oldRel = change.kind === 'renamed' ? change.from! : change.kind === 'added' ? null : change.path

    const readNew = async (): Promise<Buffer | null> => (newRel ? fs.readFile(this.localPath(newRel)).catch(() => null) : null)
    const readOld = async (): Promise<Buffer | null> => {
      if (!oldRel || !change.oldHash) return null
      const copy = await this.copies.get(change.oldHash)
      if (copy) return copy
      return fetchOld ? fetchOld(joinRemote(this.site.remoteRoot, oldRel)) : null
    }

    const path = newRel ?? oldRel ?? change.path
    if (isImagePath(path)) {
      const mime = imageMime(path)!
      const toUrl = (b: Buffer | null) => (b ? `data:${mime};base64,${b.toString('base64')}` : undefined)
      const after = await readNew()
      const before = oldRel ? await readOld() : null
      return { kind: 'image', after: toUrl(after), before: toUrl(before), beforeMissing: Boolean(oldRel) && !before }
    }
    if (change.size > MAX_TEXT_COPY_BYTES * 2) return { kind: 'too-large', size: change.size }

    const after = await readNew()
    if (after && looksBinary(after)) return { kind: 'binary', size: after.length }
    const before = oldRel ? await readOld() : null
    if (before && looksBinary(before)) return { kind: 'binary', size: before.length }
    return {
      kind: 'text',
      diff: textDiff(before?.toString('utf8') ?? '', after?.toString('utf8') ?? ''),
      oldMissing: Boolean(oldRel) && !before,
      newMissing: Boolean(newRel) && !after
    }
  }

  /** Compare the version on the server (fetched by the caller) with the local file. */
  async diffWithServer(rel: string, serverVersion: Buffer | null): Promise<DiffResult> {
    const local = await fs.readFile(this.localPath(rel)).catch(() => null)
    if (isImagePath(rel)) {
      const mime = imageMime(rel)!
      const toUrl = (b: Buffer | null) => (b ? `data:${mime};base64,${b.toString('base64')}` : undefined)
      return { kind: 'image', before: toUrl(serverVersion), after: toUrl(local), beforeMissing: !serverVersion }
    }
    const size = Math.max(local?.length ?? 0, serverVersion?.length ?? 0)
    if (size > MAX_TEXT_COPY_BYTES * 2) return { kind: 'too-large', size }
    if ((local && looksBinary(local)) || (serverVersion && looksBinary(serverVersion))) return { kind: 'binary', size }
    return {
      kind: 'text',
      diff: textDiff(serverVersion?.toString('utf8') ?? '', local?.toString('utf8') ?? ''),
      oldMissing: !serverVersion,
      newMissing: !local
    }
  }

  /** Follow references from the changed files (see deps/dependencies.ts). */
  async dependencies(changes: Change[], files: Map<string, ScannedFile>, manifest: Manifest): Promise<DependencyInfo> {
    const ignore = createIgnoreMatcher(await this.ignoreOptions())
    return analyzeDependencies({
      changes,
      files,
      manifest,
      ignore,
      readText: async (rel) => {
        try {
          const abs = this.localPath(rel)
          const st = await fs.stat(abs)
          if (st.size > MAX_TEXT_COPY_BYTES * 2) return null
          return await fs.readFile(abs, 'utf8')
        } catch {
          return null
        }
      },
      existsOnDisk: async (rel) => {
        try {
          return (await fs.stat(this.localPath(rel))).isFile()
        } catch {
          return false
        }
      }
    })
  }
}

function latestPublished(m: Manifest): string {
  let latest = m.createdAt
  for (const e of Object.values(m.files)) if (e.publishedAt > latest) latest = e.publishedAt
  return latest
}

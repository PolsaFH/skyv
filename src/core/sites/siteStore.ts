import { promises as fs } from 'node:fs'
import { join, basename, isAbsolute, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readJson, writeJsonAtomic, Mutex } from '../storage/atomicJson'
import { DEFAULT_SETTINGS, defaultPort, type Protocol, type Site, type SiteInput, type StartingPoint } from '../types'
import { UserError } from '../errors'

interface SitesFile {
  version: 1
  sites: Site[]
}

const PROTOCOLS: Protocol[] = ['ftp', 'ftps', 'sftp']

/** Suggest a friendly site name from a folder path, e.g. "/Users/x/minside.no" -> "minside.no". */
export function suggestNameFromFolder(folder: string): string {
  const name = basename(folder.replace(/[/\\]+$/, '')).trim()
  return name || 'Ny nettside'
}

/** Normalise a remote root: forward slashes, leading "/", no trailing "/", no "." or ".." segments. */
export function normalizeRemoteRoot(input: string | undefined): string {
  const parts = (input ?? '').replace(/\\/g, '/').split('/').filter((p) => p && p !== '.')
  if (parts.includes('..')) throw new UserError('Mappen på serveren kan ikke inneholde "..".')
  return '/' + parts.join('/')
}

/** Normalise a host: strip protocol prefixes and paths people often paste in. */
export function normalizeHost(input: string | undefined): string {
  return (input ?? '')
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .toLowerCase()
}

export function normalizeUrl(input: string | undefined): string {
  const s = (input ?? '').trim()
  if (!s) return ''
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withScheme)
    return u.toString().replace(/\/$/, '')
  } catch {
    throw new UserError('Nettadressen ser ikke riktig ut. Skriv den som for eksempel https://minside.no')
  }
}

function applyInput(base: Site, input: SiteInput): Site {
  const protocol = input.protocol ?? base.protocol
  if (!PROTOCOLS.includes(protocol)) throw new UserError('Ukjent tilkoblingstype.')
  const protocolChanged = input.protocol !== undefined && input.protocol !== base.protocol
  let port = input.port ?? (protocolChanged && base.port === defaultPort(base.protocol) ? defaultPort(protocol) : base.port)
  port = Number(port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UserError('Porten må være et tall mellom 1 og 65535.')

  const localPath = input.localPath !== undefined ? input.localPath : base.localPath
  if (localPath && !isAbsolute(localPath)) throw new UserError('Mappen må være en full sti.')

  const settings = { ...base.settings, ...(input.settings ?? {}) }
  settings.concurrency = clampInt(settings.concurrency, 1, 10)
  settings.quietSeconds = clampInt(settings.quietSeconds, 2, 600)
  settings.snapshotKeep = clampInt(settings.snapshotKeep, 1, 500)
  settings.snapshotMaxMB = clampInt(settings.snapshotMaxMB, 10, 100000)
  settings.diffMaxMB = clampInt(settings.diffMaxMB, 1, 10000)

  // A different server means the remembered SFTP identity no longer applies.
  const host = input.host !== undefined ? normalizeHost(input.host) : base.host
  const serverChanged = host !== base.host || port !== base.port
  const keepHostKey = serverChanged ? undefined : base.sftpHostKey

  return {
    ...base,
    name: input.name !== undefined ? input.name.trim() || base.name : base.name,
    localPath: localPath ? resolve(localPath) : '',
    protocol,
    host,
    port,
    username: input.username !== undefined ? input.username.trim() : base.username,
    remoteRoot: input.remoteRoot !== undefined ? normalizeRemoteRoot(input.remoteRoot) : base.remoteRoot,
    url: input.url !== undefined ? normalizeUrl(input.url) : base.url,
    ignoreRules: input.ignoreRules !== undefined ? input.ignoreRules : base.ignoreRules,
    sftpHostKey: input.sftpHostKey !== undefined ? input.sftpHostKey || undefined : keepHostKey,
    startingPoint: input.startingPoint !== undefined ? validStartingPoint(input.startingPoint) : base.startingPoint,
    settings
  }
}

function validStartingPoint(sp: StartingPoint | undefined): StartingPoint | undefined {
  if (!sp) return undefined
  if (!['assume-synced', 'compare', 'upload-all'].includes(sp.choice)) throw new UserError('Ukjent utgangspunkt.')
  return { choice: sp.choice, chosenAt: sp.chosenAt || new Date().toISOString(), applied: Boolean(sp.applied) }
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/**
 * Persists the list of sites as `sites.json` inside `dataDir`, and gives each site
 * its own folder `sites/<id>/` for manifest, history, snapshots and log.
 * Never touches the user's local site folder or the server.
 */
export class SiteStore {
  private mutex = new Mutex()
  private cache: SitesFile | null = null

  constructor(private readonly dataDir: string) {}

  get file(): string {
    return join(this.dataDir, 'sites.json')
  }

  siteDir(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid site id')
    return join(this.dataDir, 'sites', id)
  }

  private async load(): Promise<SitesFile> {
    if (!this.cache) {
      const data = await readJson<SitesFile>(this.file, { version: 1, sites: [] })
      // Fill in settings added in later versions.
      data.sites = data.sites.map((s) => ({ ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } }))
      this.cache = data
    }
    return this.cache
  }

  private async save(data: SitesFile): Promise<void> {
    await writeJsonAtomic(this.file, data)
    this.cache = data
  }

  async list(): Promise<Site[]> {
    const data = await this.load()
    return data.sites.map((s) => structuredClone(s))
  }

  async get(id: string): Promise<Site | undefined> {
    const data = await this.load()
    const site = data.sites.find((s) => s.id === id)
    return site ? structuredClone(site) : undefined
  }

  async create(input: SiteInput): Promise<Site> {
    return this.mutex.run(async () => {
      const data = await this.load()
      const now = new Date().toISOString()
      const protocol = input.protocol ?? 'ftp'
      const base: Site = {
        id: randomUUID(),
        name: input.localPath ? suggestNameFromFolder(input.localPath) : 'Ny nettside',
        localPath: '',
        protocol,
        host: '',
        port: defaultPort(protocol),
        username: '',
        remoteRoot: '/',
        url: '',
        ignoreRules: '',
        settings: { ...DEFAULT_SETTINGS },
        createdAt: now,
        updatedAt: now
      }
      const site = applyInput(base, input)
      if (site.localPath && data.sites.some((s) => s.localPath === site.localPath)) {
        throw new UserError('Denne mappen er allerede lagt til som en nettside.')
      }
      await this.save({ ...data, sites: [...data.sites, site] })
      await fs.mkdir(this.siteDir(site.id), { recursive: true })
      return structuredClone(site)
    })
  }

  async update(id: string, input: SiteInput): Promise<Site> {
    return this.mutex.run(async () => {
      const data = await this.load()
      const idx = data.sites.findIndex((s) => s.id === id)
      if (idx < 0) throw new UserError('Fant ikke nettsiden.')
      const updated = { ...applyInput(data.sites[idx], input), updatedAt: new Date().toISOString() }
      if (updated.localPath && data.sites.some((s, i) => i !== idx && s.localPath === updated.localPath)) {
        throw new UserError('Denne mappen er allerede lagt til som en nettside.')
      }
      const sites = [...data.sites]
      sites[idx] = updated
      await this.save({ ...data, sites })
      return structuredClone(updated)
    })
  }

  /**
   * Remove a site from the app. Deletes only the app's own data for the site
   * (history, snapshots, log). Never touches the local folder or the server.
   */
  async remove(id: string): Promise<void> {
    return this.mutex.run(async () => {
      const data = await this.load()
      if (!data.sites.some((s) => s.id === id)) return
      await this.save({ ...data, sites: data.sites.filter((s) => s.id !== id) })
      await fs.rm(this.siteDir(id), { recursive: true, force: true })
    })
  }
}

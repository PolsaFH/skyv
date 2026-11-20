import { promises as fs } from 'node:fs'
import type { Site, SiteInput } from '../types'
import type { SiteStore } from '../sites/siteStore'
import { UserError } from '../errors'

export interface ExportedSite {
  name: string
  localPath: string
  protocol: Site['protocol']
  host: string
  port: number
  username: string
  remoteRoot: string
  url: string
  ignoreRules: string
  settings: Site['settings']
  sftpHostKey?: string
}

export interface ExportFile {
  format: 'skyv-nettsider'
  version: 1
  exportedAt: string
  sites: ExportedSite[]
}

/** Site setup without passwords, history, snapshots or anything else stored by the app. */
export function exportSites(sites: Site[]): ExportFile {
  return {
    format: 'skyv-nettsider',
    version: 1,
    exportedAt: new Date().toISOString(),
    sites: sites.map((s) => ({
      name: s.name,
      localPath: s.localPath,
      protocol: s.protocol,
      host: s.host,
      port: s.port,
      username: s.username,
      remoteRoot: s.remoteRoot,
      url: s.url,
      ignoreRules: s.ignoreRules,
      settings: s.settings,
      sftpHostKey: s.sftpHostKey
    }))
  }
}

export function parseExport(text: string): ExportFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new UserError('Filen kunne ikke leses.', 'Velg en fil som er eksportert fra Skyv.')
  }
  const d = data as Partial<ExportFile>
  if (!d || d.format !== 'skyv-nettsider' || d.version !== 1 || !Array.isArray(d.sites)) {
    throw new UserError('Dette er ikke en eksportfil fra Skyv.', 'Velg en fil som er eksportert fra Skyv.')
  }
  return d as ExportFile
}

export interface ImportResult {
  imported: string[]
  skipped: Array<{ name: string; reason: string }>
  /** Imported, but the folder does not exist on this Mac. */
  missingFolder: string[]
}

/**
 * Add the sites from an export file. Existing sites with the same folder are skipped.
 * Imported sites have no password and no starting point; the user adds those.
 */
export async function importSites(store: SiteStore, file: ExportFile): Promise<ImportResult> {
  const existing = new Set((await store.list()).map((s) => s.localPath))
  const result: ImportResult = { imported: [], skipped: [], missingFolder: [] }
  for (const s of file.sites) {
    const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim() : 'Importert nettside'
    if (s.localPath && existing.has(s.localPath)) {
      result.skipped.push({ name, reason: 'finnes allerede i Skyv' })
      continue
    }
    const input: SiteInput = {
      name,
      localPath: typeof s.localPath === 'string' ? s.localPath : '',
      protocol: s.protocol,
      host: s.host,
      port: s.port,
      username: s.username,
      remoteRoot: s.remoteRoot,
      url: s.url,
      ignoreRules: typeof s.ignoreRules === 'string' ? s.ignoreRules : '',
      settings: s.settings,
      sftpHostKey: s.sftpHostKey
    }
    try {
      await store.create(input)
      result.imported.push(name)
      existing.add(input.localPath ?? '')
      if (input.localPath && !(await fs.stat(input.localPath).then((st) => st.isDirectory(), () => false))) result.missingFolder.push(name)
    } catch (err) {
      result.skipped.push({ name, reason: err instanceof UserError ? err.message.replace(/\.$/, '').toLowerCase() : 'ugyldige opplysninger' })
    }
  }
  return result
}

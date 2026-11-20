import { promises as fs } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { RemoteClient } from '../remote/types'
import type { SiteWorkspace } from '../workspace'
import { joinRemote } from '../remote/paths'
import { hashFile } from '../scan/scanner'
import { UNKNOWN_REMOTE_HASH } from '../manifest/startingPoint'
import { UserError } from '../errors'
import type { Deviation } from './deviations'
import type { ServerCheckStore } from './serverCheck'

export type DeviationAction =
  /** missing: give it out again (it becomes a new change, then normal release). */
  | 'reupload'
  /** missing: remove the file on the Mac too (to the Trash), and forget it. */
  | 'delete-local'
  /** missing: forget it; if it is still on the Mac it shows up as new. */
  | 'let-go'
  /** changed: put the Mac's version in the Trash, then download the server's version. */
  | 'fetch-server'
  /** changed: accept that the server changed; my version goes out in the next release. */
  | 'overwrite-mine'
  /** server-only: download it to the Mac. */
  | 'fetch-to-mac'
  /** server-only: leave it, and do not show it again. */
  | 'dismiss'

const ALLOWED: Record<Deviation['kind'], DeviationAction[]> = {
  missing: ['reupload', 'delete-local', 'let-go'],
  changed: ['fetch-server', 'overwrite-mine'],
  'server-only': ['fetch-to-mac', 'dismiss']
}

export interface ResolveDeps {
  workspace: SiteWorkspace
  remoteRoot: string
  store: ServerCheckStore
  /** Connected client, only needed for downloads. */
  connect: () => Promise<RemoteClient>
  /** Move a local file to the Trash (Electron's shell.trashItem in the app). Never deletes permanently. */
  trash: (absPath: string) => Promise<void>
}

export interface ResolveResult {
  /** Norwegian description for the log. */
  message: string
  /** Paths that should go out in a release right away ("Last opp på nytt"). */
  release?: string[]
}

async function downloadInto(client: RemoteClient, remotePath: string, localAbs: string): Promise<void> {
  await fs.mkdir(dirname(localAbs), { recursive: true })
  const tmp = join(dirname(localAbs), `.${basename(localAbs)}.${randomBytes(4).toString('hex')}.skyvtmp`)
  try {
    await client.download(remotePath, tmp)
    await fs.rename(tmp, localAbs)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(
    () => true,
    () => false
  )
}

/**
 * Carry out the user's choice for one deviation. The Mac is the source of truth: a local file is
 * only ever replaced after it has been moved to the Trash, and nothing is deleted on the server.
 */
export async function resolveDeviation(deps: ResolveDeps, deviation: Deviation, action: DeviationAction): Promise<ResolveResult> {
  if (!ALLOWED[deviation.kind].includes(action)) throw new UserError('Dette valget passer ikke for denne filen.')
  const { workspace } = deps
  const rel = deviation.path
  const local = workspace.localPath(rel)
  const remotePath = joinRemote(deps.remoteRoot, rel)
  let result: ResolveResult

  switch (action) {
    case 'reupload':
    case 'let-go': {
      await workspace.manifest.update((m) => {
        delete m.files[rel]
      })
      result =
        action === 'reupload'
          ? { message: `${rel} manglet på serveren og blir lastet opp på nytt.`, release: (await exists(local)) ? [rel] : undefined }
          : { message: `${rel} manglet på serveren og er fjernet fra Skyvs oversikt.` }
      if (action === 'reupload' && !result.release) throw new UserError('Filen finnes ikke på Macen heller, så den kan ikke lastes opp på nytt.')
      break
    }
    case 'delete-local': {
      if (await exists(local)) await deps.trash(local)
      await workspace.manifest.update((m) => {
        delete m.files[rel]
      })
      result = { message: `${rel} manglet på serveren og ble flyttet til Papirkurven på Macen.` }
      break
    }
    case 'fetch-server':
    case 'fetch-to-mac': {
      if (action === 'fetch-to-mac' && (await exists(local))) {
        throw new UserError('Det finnes allerede en fil med dette navnet på Macen.', 'Skyv overskriver aldri filer på Macen uten at du har valgt det.')
      }
      const client = await deps.connect()
      try {
        // Download first; only then move the Mac's version to the Trash and put the server's in place.
        // Temporary folder inside the site folder (same disk, so the final move is instant). The name
        // ends in .skyvtmp, which is always ignored, so background watching does not react to it.
        const tmpDir = join(dirname(workspace.localPath('x')), `.skyv-hent-${randomBytes(4).toString('hex')}.skyvtmp`)
        await fs.mkdir(tmpDir)
        const tmpFile = join(tmpDir, basename(local))
        try {
          await downloadInto(client, remotePath, tmpFile)
          if (await exists(local)) await deps.trash(local)
          await fs.mkdir(dirname(local), { recursive: true })
          await fs.rename(tmpFile, local)
        } finally {
          await fs.rm(tmpDir, { recursive: true, force: true })
        }
        const st = await fs.stat(local)
        const hash = await hashFile(local)
        const remoteInfo = await client.stat(remotePath)
        await workspace.copies.putFile(hash, rel, local, st.size).catch(() => undefined)
        await workspace.manifest.update((m) => {
          m.files[rel] = {
            hash,
            size: st.size,
            localMtimeMs: Math.round(st.mtimeMs),
            remoteSize: remoteInfo?.size ?? st.size,
            remoteMtimeMs: remoteInfo?.modifiedAt,
            publishedAt: new Date().toISOString()
          }
        })
      } finally {
        await client.close()
      }
      result = {
        message:
          action === 'fetch-server'
            ? `Serverens versjon av ${rel} ble hentet til Macen. Den forrige versjonen på Macen ligger i Papirkurven.`
            : `${rel} ble hentet fra serveren til Macen.`
      }
      break
    }
    case 'overwrite-mine': {
      if (!(await exists(local))) throw new UserError('Filen finnes ikke på Macen.', 'Velg heller å hente serverens versjon.')
      await workspace.manifest.update((m) => {
        const cur = m.files[rel]
        // Record what is on the server now, and mark the content as unknown so the Mac's version goes out next.
        m.files[rel] = {
          hash: UNKNOWN_REMOTE_HASH,
          size: deviation.remoteSize ?? cur?.size ?? 0,
          localMtimeMs: 0,
          remoteSize: deviation.remoteSize,
          remoteMtimeMs: deviation.remoteModifiedAt,
          publishedAt: cur?.publishedAt ?? new Date().toISOString()
        }
      })
      result = { message: `${rel} er endret på serveren. Versjonen på Macen blir med i neste utgivelse.` }
      break
    }
    case 'dismiss': {
      await deps.store.dismiss(rel)
      result = { message: `${rel} finnes bare på serveren og blir latt være.` }
      break
    }
  }
  await deps.store.resolved(rel)
  return result
}

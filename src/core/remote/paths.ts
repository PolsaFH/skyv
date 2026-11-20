import { UserError } from '../errors'

/** Normalise a remote absolute path: forward slashes, leading "/", no trailing slash, no "." segments. Rejects "..". */
export function normalizeRemotePath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.')
  if (parts.includes('..')) throw new UserError('Stien på serveren kan ikke inneholde "..".')
  return '/' + parts.join('/')
}

/**
 * Join a remote root with a relative path, guaranteeing the result stays inside the root.
 * The relative path comes from local scanning and must never escape the remote root.
 */
export function joinRemote(root: string, relative: string): string {
  const base = normalizeRemotePath(root)
  const rel = relative.replace(/\\/g, '/')
  const parts = rel.split('/').filter((p) => p && p !== '.')
  if (parts.includes('..') || rel.startsWith('/')) {
    throw new UserError(`Filstien "${relative}" peker utenfor nettsidens mappe og blir ikke brukt.`)
  }
  if (parts.length === 0) return base
  return (base === '/' ? '' : base) + '/' + parts.join('/')
}

export function parentOf(path: string): string {
  const p = normalizeRemotePath(path)
  if (p === '/') return '/'
  const idx = p.lastIndexOf('/')
  return idx <= 0 ? '/' : p.slice(0, idx)
}

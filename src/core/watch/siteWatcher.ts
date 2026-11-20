import { watch, type FSWatcher } from 'chokidar'
import { relative, sep } from 'node:path'
import type { IgnoreMatcher } from '../scan/ignoreRules'

export interface SiteWatcherOptions {
  root: string
  ignore: IgnoreMatcher
  /** Called with a site-relative path for every add/change/remove that is not ignored. */
  onPath: (relPath: string) => void
  onError?: (err: unknown) => void
}

/**
 * Watches a site folder in the background. Ignored files and folders are never reported
 * (and ignored folders like node_modules are not even watched). Symbolic links are not followed.
 */
export class SiteWatcher {
  private watcher: FSWatcher | null = null

  constructor(private readonly opts: SiteWatcherOptions) {}

  private rel(abs: string): string {
    return relative(this.opts.root, abs).split(sep).join('/')
  }

  async start(): Promise<void> {
    const w = watch(this.opts.root, {
      ignoreInitial: true,
      followSymlinks: false,
      ignorePermissionErrors: true,
      ignored: (abs: string, stats?: { isDirectory(): boolean }) => {
        const r = this.rel(abs)
        if (!r || r.startsWith('..')) return false
        return this.opts.ignore(r, stats?.isDirectory() ?? false) || this.opts.ignore(r, true)
      }
    })
    w.on('all', (event, abs) => {
      if (event === 'addDir' || event === 'unlinkDir') return
      const r = this.rel(String(abs))
      if (r && !r.startsWith('..') && !this.opts.ignore(r)) this.opts.onPath(r)
    })
    w.on('error', (e) => this.opts.onError?.(e))
    await new Promise<void>((resolve) => w.once('ready', () => resolve()))
    this.watcher = w
  }

  async stop(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
  }
}

import type { SiteService } from '../sites/siteService'
import type { Workspaces } from './workspaces'
import { runChecks } from '../checks/checks'
import { IgnoredFindings } from '../checks/ignored'
import type { Finding } from '../checks/types'
import { changeKey } from '../manifest/changes'
import { isTextPath } from '../files/fileTypes'
import { phpLint, type PhpLintResult } from '../php/php'
import { getPhp } from './phpService'

export interface CheckResult {
  findings: Finding[]
  ignoredCount: number
}

/** Runs the pre-release checks ("feilfangere") for the selected changes of a site. */
export class ChecksService {
  /** PHP lint results by file hash, so unchanged files are not checked again. */
  private lintCache = new Map<string, PhpLintResult>()

  constructor(
    private readonly sites: SiteService,
    private readonly workspaces: Workspaces
  ) {}

  ignored(siteId: string): IgnoredFindings {
    return new IgnoredFindings(this.sites.store.siteDir(siteId))
  }

  async run(siteId: string, keys: string[]): Promise<CheckResult> {
    const ws = await this.workspaces.get(siteId)
    const cs = ws.lastChangeSet ?? (await this.workspaces.scan(siteId))
    const wanted = new Set(keys)
    const changes = cs.changes.filter((c) => wanted.has(changeKey(c)))
    const manifest = await ws.manifest.load()
    const php = await getPhp()

    const textCache = new Map<string, Promise<string | null>>()
    const readText = (p: string) => {
      let t = textCache.get(p)
      if (!t) {
        t = ws.readText(p)
        textCache.set(p, t)
      }
      return t
    }

    const findings = await runChecks({
      changes,
      publishedCount: manifest ? Object.keys(manifest.files).length : 0,
      localCount: cs.fileCount,
      deps: cs.deps,
      readText,
      allTextFiles: ws.scannedPaths.filter(isTextPath),
      selectedPaths: new Set(changes.map((c) => c.path)),
      phpLint: php
        ? async (path) => {
            const hash = changes.find((c) => c.path === path)?.hash
            const cached = hash ? this.lintCache.get(hash) : undefined
            if (cached) return cached
            const r = await phpLint(php.path, ws.localPath(path))
            if (hash) this.lintCache.set(hash, r)
            return r
          }
        : undefined
    })
    const { active, ignoredCount } = await this.ignored(siteId).filter(findings)
    return { findings: active, ignoredCount }
  }
}

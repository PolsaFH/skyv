import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promises as fs, constants as fsConstants } from 'node:fs'
import { createServer, connect } from 'node:net'
import { delimiter, join } from 'node:path'

/**
 * Apps opened from Finder get a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), so Homebrew's PHP is
 * not found that way. These locations are always checked in addition to PATH.
 */
export const KNOWN_PHP_LOCATIONS = ['/opt/homebrew/bin/php', '/usr/local/bin/php']

export interface PhpInfo {
  path: string
  /** e.g. "8.5.12" */
  version: string
}

export interface FindPhpOptions {
  /** PATH to search; defaults to process.env.PATH. Pass "" to simulate an app opened from Finder. */
  pathEnv?: string
  extraLocations?: string[]
}

function run(file: string, args: string[], timeoutMs = 10000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024, env: { ...process.env, LANG: 'C' } }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0
      resolve({ stdout: String(stdout), stderr: String(stderr), code })
    })
  })
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsConstants.X_OK)
    return (await fs.stat(p)).isFile()
  } catch {
    return false
  }
}

/** Candidate paths in search order: PATH first, then the known Homebrew locations. Duplicates removed. */
export function phpCandidates(opts: FindPhpOptions = {}): string[] {
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? ''
  const fromPath = pathEnv
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, 'php'))
  return [...new Set([...fromPath, ...KNOWN_PHP_LOCATIONS, ...(opts.extraLocations ?? [])])]
}

/** Find a working PHP command line program, or null if there is none. */
export async function findPhp(opts: FindPhpOptions = {}): Promise<PhpInfo | null> {
  for (const candidate of phpCandidates(opts)) {
    if (!(await isExecutable(candidate))) continue
    const res = await run(candidate, ['-v'])
    const m = /^PHP (\d+\.\d+\.\d+)/m.exec(res.stdout)
    if (res.code === 0 && m) return { path: candidate, version: m[1] }
  }
  return null
}

export interface PhpLintResult {
  ok: boolean
  /** Line number of the first error, if PHP reported one. */
  line?: number
  /** Error text from PHP with file paths removed. */
  message?: string
}

/** Run `php -l` (syntax check only; the file is not executed). */
export async function phpLint(phpPath: string, file: string): Promise<PhpLintResult> {
  const res = await run(phpPath, ['-n', '-l', '-d', 'display_errors=1', '-d', 'error_reporting=E_ALL', file], 15000)
  if (res.code === 0) return { ok: true }
  const text = `${res.stdout}\n${res.stderr}`
  const m = /(?:PHP )?((?:Parse|Fatal) error):\s*(.+?) in .+? on line (\d+)/.exec(text)
  if (m) return { ok: false, line: Number(m[3]), message: `${m[1]}: ${m[2]}` }
  return { ok: false, message: text.replace(/\s+/g, ' ').trim().slice(0, 300) }
}

export interface PhpServer {
  url: string
  port: number
  stop: () => Promise<void>
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

function waitForPort(port: number, timeoutMs: number, child: ChildProcess): Promise<void> {
  const until = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (child.exitCode !== null) return reject(new Error('PHP server exited'))
      const sock = connect(port, '127.0.0.1')
      sock.once('connect', () => {
        sock.destroy()
        resolve()
      })
      sock.once('error', () => {
        sock.destroy()
        if (Date.now() > until) reject(new Error('PHP server did not start'))
        else setTimeout(attempt, 100)
      })
    }
    attempt()
  })
}

/**
 * Start PHP's built-in web server (`php -S`) for a site folder, bound to 127.0.0.1 only,
 * so nothing is reachable from other machines.
 */
export async function startPhpServer(phpPath: string, root: string, port?: number, extraArgs: string[] = [], routerScript?: string): Promise<PhpServer> {
  const p = port ?? (await freePort())
  const args = [...extraArgs, '-S', `127.0.0.1:${p}`, '-t', root, ...(routerScript ? [routerScript] : [])]
  const child = spawn(phpPath, args, { cwd: root, stdio: 'ignore' })
  try {
    await waitForPort(p, 8000, child)
  } catch (err) {
    child.kill()
    throw err
  }
  return {
    url: `http://127.0.0.1:${p}`,
    port: p,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve()
        child.once('exit', () => resolve())
        child.kill()
      })
  }
}

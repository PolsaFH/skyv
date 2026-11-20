import { promises as fs, constants as fsConstants } from 'node:fs'
import { join, delimiter } from 'node:path'
import { UserError } from '../errors'

export interface ToolPaths {
  /** Executable that runs Node code: Skyv's own Electron binary. */
  runtime: string
  /** The bundled MCP bridge and command line files. */
  bridgeScript: string
  cliScript: string
  /** In the installed app: Contents/Resources/bin/skyv-mcp (a small launcher). */
  bridgeLauncher?: string
}

export interface SetupInfo {
  /** How Claude Code and the Claude app should start the bridge. */
  command: string
  args: string[]
  env: Record<string, string>
  claudeCodeCommand: string
  claudeDesktopJson: string
  claudeDesktopConfigPath: string
}

/** Quote a path for the shell (single quotes, safe with spaces). */
export function shellQuote(s: string): string {
  return /^[A-Za-z0-9_\/.,:@%+=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Ready-made setup for AI clients. In the installed app this is just the launcher script;
 * in development it is Electron with ELECTRON_RUN_AS_NODE=1 and the built bridge file.
 */
export function setupInfo(paths: ToolPaths, home: string): SetupInfo {
  const command = paths.bridgeLauncher ?? paths.runtime
  const args = paths.bridgeLauncher ? [] : [paths.bridgeScript]
  const env: Record<string, string> = paths.bridgeLauncher ? {} : { ELECTRON_RUN_AS_NODE: '1' }
  const envFlags = Object.entries(env).map(([k, v]) => `-e ${k}=${v} `).join('')
  const claudeCodeCommand = `claude mcp add skyv ${envFlags}-- ${[command, ...args].map(shellQuote).join(' ')}`
  const server: Record<string, unknown> = { command, args }
  if (Object.keys(env).length > 0) server.env = env
  const claudeDesktopJson = JSON.stringify({ mcpServers: { skyv: server } }, null, 2)
  return {
    command,
    args,
    env,
    claudeCodeCommand,
    claudeDesktopJson,
    claudeDesktopConfigPath: join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }
}

/** The small script placed in ~/.local/bin/skyv. Absolute paths, so it works from any folder. */
export function cliScript(paths: ToolPaths): string {
  return [
    '#!/bin/sh',
    '# skyv: command line for Skyv (installed from Skyv → Innstillinger → AI-tilkobling).',
    '# Uses the same local connection and permissions as the AI connection in the app.',
    `ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(paths.runtime)} ${shellQuote(paths.cliScript)} "$@"`,
    ''
  ].join('\n')
}

export interface InstallResult {
  path: string
  /** "created" or "updated" (an earlier Skyv script was replaced). */
  action: 'created' | 'updated'
  /** Whether the folder is on PATH for programs started the way Skyv was started. */
  onPath: boolean
}

/**
 * Put the `skyv` command in a folder (normally ~/.local/bin) without administrator rights.
 * Refuses to replace a file there that Skyv did not write.
 */
export async function installCli(dir: string, script: string, pathEnv = process.env.PATH ?? ''): Promise<InstallResult> {
  await fs.mkdir(dir, { recursive: true })
  const target = join(dir, 'skyv')
  let action: InstallResult['action'] = 'created'
  try {
    const existing = await fs.readFile(target, 'utf8')
    if (!existing.includes('command line for Skyv')) {
      throw new UserError(`${target} finnes allerede og er ikke laget av Skyv.`, 'Skyv rører ikke filer det ikke har laget selv. Gi den andre filen et annet navn hvis du vil installere kommandoen.')
    }
    action = 'updated'
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  await fs.writeFile(target, script, { mode: 0o755 })
  await fs.chmod(target, 0o755)
  await fs.access(target, fsConstants.X_OK)
  const onPath = pathEnv.split(delimiter).some((p) => p.replace(/\/+$/, '') === dir.replace(/\/+$/, ''))
  return { path: target, action, onPath }
}

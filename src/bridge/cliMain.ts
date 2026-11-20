// skyv: command line that talks to the running Skyv app (same API and permissions as MCP).
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { socketPathFor } from '../core/agentApi/socket'
import { connectOrLaunch } from '../core/agentApi/connect'
import { runCli } from '../core/cli/cli'

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || ['help', '--help', '-h'].includes(argv[0])) {
    return runCli(['help'], { call: async () => ({ ok: true, result: {} }), cwd: process.cwd(), out: console.log, err: console.error })
  }
  const dataDir = process.env.SKYV_DATA_DIR || join(homedir(), 'Library', 'Application Support', 'Skyv')
  const socketPath = process.env.SKYV_SOCKET || socketPathFor(dataDir)
  const client = await connectOrLaunch(socketPath, { name: 'skyv-kommandolinje' }, () => new Promise((r) => execFile('open', ['-g', '-a', process.env.SKYV_APP || 'Skyv'], () => r())))
  if (!client) {
    console.error('Åpne Skyv, så prøver vi igjen.')
    return 1
  }
  try {
    return await runCli(argv, { call: (m, p) => client.call(m, p), cwd: process.cwd(), out: (t) => console.log(t), err: (t) => console.error(t) })
  } finally {
    client.close()
  }
}

void main().then((code) => process.exit(code))

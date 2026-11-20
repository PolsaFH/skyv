// skyv-mcp: MCP server over stdio that forwards to the running Skyv app.
// Run with Skyv's own Electron (ELECTRON_RUN_AS_NODE=1) or Node.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createBridge } from './bridge'
import { socketPathFor } from '../core/agentApi/socket'

const dataDir = process.env.SKYV_DATA_DIR || join(homedir(), 'Library', 'Application Support', 'Skyv')
const socketPath = process.env.SKYV_SOCKET || socketPathFor(dataDir)

const { server, close } = createBridge({
  socketPath,
  launchApp: () =>
    new Promise<void>((resolve) => {
      // Start Skyv in the background without taking focus.
      execFile('open', ['-g', '-a', process.env.SKYV_APP || 'Skyv'], () => resolve())
    })
})

const transport = new StdioServerTransport()
process.on('SIGINT', () => {
  close()
  process.exit(0)
})
process.stdin.on('close', () => {
  close()
  process.exit(0)
})
void server.connect(transport)

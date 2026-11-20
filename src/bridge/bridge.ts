import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ALL_TOOLS } from '../core/agentApi/toolDefs'
import type { SocketClient } from '../core/agentApi/socket'
import { connectOrLaunch } from '../core/agentApi/connect'
import type { ApiResponse } from '../core/agentApi/api'

export const NOT_RUNNING_MESSAGE = 'Åpne Skyv, så prøver vi igjen.'

export interface BridgeOptions {
  socketPath: string
  /** Try to start the Skyv app in the background (e.g. `open -g -a Skyv`). Resolves when the command ran. */
  launchApp: () => Promise<void>
  /** How long to keep retrying after launching the app. */
  launchWaitMs?: number
  version?: string
}

/** MCP reply for an API response: JSON text (and structured content), images as image content. */
export function toToolResult(res: ApiResponse): CallToolResult {
  if (!res.ok) {
    const text = `${res.error.message}${res.error.hint ? `\n${res.error.hint}` : ''}`
    return { isError: true, content: [{ type: 'text', text }], structuredContent: { error: res.error } }
  }
  const result = res.result as Record<string, unknown>
  const image = result && typeof result === 'object' ? (result.image as { mimeType: string; data: string } | undefined) : undefined
  if (image && typeof image.data === 'string') {
    const { image: _img, ...rest } = result
    void _img
    return {
      content: [
        { type: 'image', data: image.data, mimeType: image.mimeType },
        { type: 'text', text: JSON.stringify(rest, null, 2) }
      ]
    }
  }
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as Record<string, unknown> }
}

/**
 * The MCP side of skyv-mcp: every tool call is forwarded to the Skyv app over the local socket.
 * All permission checks happen in the app. If the app is not running, the bridge tries to start
 * it and retries for a few seconds before giving up with a friendly message.
 */
export function createBridge(opts: BridgeOptions): { server: McpServer; close: () => void } {
  const server = new McpServer({ name: 'skyv', version: opts.version ?? '0.2.0' })
  let client: SocketClient | null = null
  const clientName = () => ({ name: server.server.getClientVersion()?.name ?? 'ukjent-ai-klient' })

  const ensureConnected = async (): Promise<SocketClient | null> => {
    if (client?.connected) return client
    client = await connectOrLaunch(opts.socketPath, clientName, opts.launchApp, opts.launchWaitMs ?? 15000)
    return client
  }

  for (const def of ALL_TOOLS) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.input,
        annotations: { title: def.title, readOnlyHint: def.readOnly, destructiveHint: false, openWorldHint: false }
      },
      async (args: Record<string, unknown>) => {
        const c = await ensureConnected()
        if (!c) return { isError: true, content: [{ type: 'text', text: NOT_RUNNING_MESSAGE }] }
        return toToolResult(await c.call(def.name, args ?? {}))
      }
    )
  }

  return { server, close: () => client?.close() }
}

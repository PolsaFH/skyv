import { NotRunningError, SocketClient } from './socket'
import type { ClientInfo } from './api'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Connect to the running Skyv app. If it is not running, start it (in the background) and keep
 * trying for a while. Returns null if Skyv could not be reached. Used by the MCP bridge and the CLI.
 */
export async function connectOrLaunch(
  socketPath: string,
  client: ClientInfo | (() => ClientInfo),
  launchApp: () => Promise<void>,
  waitMs = 15000
): Promise<SocketClient | null> {
  const attempt = async () => {
    const c = new SocketClient(socketPath, client)
    await c.connect()
    return c
  }
  try {
    return await attempt()
  } catch (err) {
    if (!(err instanceof NotRunningError)) return null
  }
  await launchApp().catch(() => undefined)
  const until = Date.now() + waitMs
  while (Date.now() < until) {
    await sleep(400)
    try {
      return await attempt()
    } catch {
      /* keep waiting */
    }
  }
  return null
}

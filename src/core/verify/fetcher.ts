import type { Fetcher } from './postCheck'

const MAX_BODY = 2 * 1024 * 1024

/** Fetch with a timeout, a neutral User-Agent and no caching. Asset bodies are not downloaded. */
export function createFetcher(timeoutMs = 15000): Fetcher {
  return async (url, { wantBody }) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Skyv (sjekk etter opplasting)', 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
      })
      let body = ''
      if (wantBody && res.body) {
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let size = 0
        while (size < MAX_BODY) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          size += value.length
        }
        await reader.cancel().catch(() => undefined)
        body = Buffer.concat(chunks).toString('utf8')
      } else {
        await res.body?.cancel().catch(() => undefined)
      }
      return { status: res.status, contentType: res.headers.get('content-type') ?? '', body, url: res.url || url }
    } finally {
      clearTimeout(timer)
    }
  }
}

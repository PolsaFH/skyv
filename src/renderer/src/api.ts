import type { SkyvApi } from '../../core/api'

declare global {
  interface Window {
    skyv: SkyvApi
  }
}

export const api = window.skyv

export interface FriendlyError {
  message: string
  hint?: string
}

/** Turn whatever was thrown into a message that is safe and friendly to show. */
export function friendlyError(err: unknown): FriendlyError {
  const raw = err instanceof Error ? err.message : String(err)
  // Errors from preload are JSON, possibly prefixed by Electron's "Error invoking remote method".
  const start = raw.indexOf('{')
  if (start >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(start)) as FriendlyError
      if (parsed && typeof parsed.message === 'string') return parsed
    } catch {
      /* fall through */
    }
  }
  return { message: 'Noe gikk galt. Prøv igjen.' }
}

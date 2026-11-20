/**
 * An error whose message is written for the user (Norwegian, no jargon) and is safe to show.
 * Anything that is not a UserError is replaced with a generic message before reaching the UI.
 */
export class UserError extends Error {
  constructor(
    message: string,
    /** Optional hint about what the user can do. */
    public readonly hint?: string
  ) {
    super(message)
    this.name = 'UserError'
  }
}

export interface SerializedError {
  message: string
  hint?: string
}

/** Remove anything that looks like a secret from a string before it is logged or shown. */
export function redact(text: string, secrets: Array<string | undefined> = []): string {
  let out = text
  for (const s of secrets) {
    if (s && s.length >= 3) out = out.split(s).join('••••')
  }
  // URLs with embedded credentials: ftp://user:pass@host
  out = out.replace(/([a-z]+:\/\/[^:/\s]+:)[^@\s]+@/gi, '$1••••@')
  // "PASS xyz" from FTP protocol traces
  out = out.replace(/\bPASS\s+\S+/g, 'PASS ••••')
  return out
}

export function toSerializedError(err: unknown, secrets: Array<string | undefined> = []): SerializedError {
  if (err instanceof UserError) {
    return { message: redact(err.message, secrets), hint: err.hint && redact(err.hint, secrets) }
  }
  return { message: 'Noe uventet gikk galt.', hint: 'Prøv igjen. Hvis det skjer flere ganger, avslutt Skyv og start det på nytt.' }
}

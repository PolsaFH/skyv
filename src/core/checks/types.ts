export type Severity = 'block' | 'warn' | 'info'

export type CheckId =
  | 'secret'
  | 'db-password'
  | 'private-key'
  | 'sensitive-file'
  | 'local-link'
  | 'broken-link'
  | 'not-selected'
  | 'placeholder-text'
  | 'php-syntax'
  | 'invalid-json'
  | 'many-deletions'
  | 'many-changes'
  | 'large-file'
  | 'console-log'
  | 'unused-image'
  | 'missing-alt'
  | 'missing-title'

export interface Finding {
  /** Stable across scans (does not include the line number), used to remember "ignore". */
  key: string
  severity: Severity
  check: CheckId
  /** Site-relative file, or "" for findings about the release as a whole. */
  path: string
  line?: number
  /** Short Norwegian explanation. Never contains a full secret. */
  message: string
  /** Optional hint about what to do. */
  hint?: string
}

export const SEVERITY_ORDER: Record<Severity, number> = { block: 0, warn: 1, info: 2 }

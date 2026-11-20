import { extensionOf } from '../files/fileTypes'

export interface SecretMatch {
  kind: 'openai' | 'anthropic' | 'aws' | 'google' | 'stripe' | 'github' | 'private-key' | 'db-password'
  /** Index in the text where the secret starts. */
  index: number
  /** The secret value itself (only used for masking and fingerprinting, never shown in full). */
  value: string
}

const LABELS: Record<SecretMatch['kind'], string> = {
  openai: 'En nøkkel til OpenAI',
  anthropic: 'En nøkkel til Anthropic (Claude)',
  aws: 'En tilgangsnøkkel til Amazon (AWS)',
  google: 'En nøkkel til Google',
  stripe: 'En hemmelig nøkkel til Stripe (betaling)',
  github: 'En tilgangsnøkkel til GitHub',
  'private-key': 'En privat nøkkel',
  'db-password': 'Et passord til databasen'
}

export function secretLabel(kind: SecretMatch['kind']): string {
  return LABELS[kind]
}

/** Show only enough to recognise the secret: "sk-ant-…x7Q" / "••••" for passwords. */
export function maskSecret(kind: SecretMatch['kind'], value: string): string {
  if (kind === 'db-password' || kind === 'private-key') return '••••••'
  const prefix = /^(sk-ant-|sk-proj-|sk-|AKIA|ASIA|AIza|sk_live_|rk_live_|github_pat_|gh[pousr]_)/.exec(value)?.[0] ?? value.slice(0, 3)
  return `${prefix}…${value.slice(-3)}`
}

/** Secret-looking tokens must look random: digits and letters mixed, or very long. */
function looksRandom(token: string): boolean {
  const body = token.replace(/^[a-z]+[-_]/i, '')
  return (/\d/.test(body) && /[A-Za-z]/.test(body) && /[A-Z]/.test(body)) || body.length >= 40
}

const TOKEN_PATTERNS: Array<{ kind: SecretMatch['kind']; re: RegExp; check?: (v: string) => boolean }> = [
  { kind: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai', re: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, check: looksRandom },
  { kind: 'aws', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'google', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'stripe', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/g },
  { kind: 'github', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g }
]

const PLACEHOLDER_PASSWORDS = new Set(['', 'password', 'passord', 'your_password', 'yourpassword', 'changeme', 'secret', 'xxx', 'xxxx', '********', 'root', 'example'])

const DB_PASSWORD_PATTERNS: RegExp[] = [
  /define\(\s*['"](?:DB_PASSWORD|DB_PASS|DATABASE_PASSWORD|MYSQL_PASSWORD)['"]\s*,\s*(['"])(.*?)\1/gi,
  /\b(?:DB_PASSWORD|DB_PASS|DATABASE_PASSWORD|MYSQL_PASSWORD)\s*[=:]\s*(['"]?)([^'"\s;]+)\1/g,
  /\$(?:db_?|database_?|mysql_?)?pass(?:word|wd|ord)?\s*=\s*(['"])(.*?)\1/gi,
  /(['"])(?:db_?|database_?|mysql_?)?pass(?:word|wd|ord)?\1\s*(?:=>|:)\s*(['"])(.*?)\2/gi,
  /(?:mysqli_connect|new\s+mysqli|new\s+PDO)\s*\([^;]*?,\s*['"][^'"]*['"]\s*,\s*(['"])(.*?)\1/gi
]

/** Files where "password = '...'" usually means a real database password. */
function isConfigLike(path: string): boolean {
  const ext = extensionOf(path)
  return ['php', 'inc', 'phtml', 'ini', 'env', 'yml', 'yaml', 'conf', 'cnf'].includes(ext) || /(^|\/)\.env/.test(path)
}

/** Find API keys, private keys and database passwords in a file's text. */
export function findSecrets(path: string, text: string): SecretMatch[] {
  const out: SecretMatch[] = []
  const seen = new Set<string>()
  const add = (m: SecretMatch) => {
    const k = `${m.kind}:${m.value}`
    if (seen.has(k)) return
    seen.add(k)
    out.push(m)
  }

  for (const p of TOKEN_PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      if (p.check && !p.check(m[0])) continue
      add({ kind: p.kind, index: m.index!, value: m[0] })
    }
  }
  for (const m of text.matchAll(/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g)) add({ kind: 'private-key', index: m.index!, value: m[0] })

  if (isConfigLike(path)) {
    for (const re of DB_PASSWORD_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const value = m[m.length - 1] ?? ''
        if (PLACEHOLDER_PASSWORDS.has(value.toLowerCase()) || value.startsWith('$') || /getenv|\$_(ENV|SERVER)/.test(value)) continue
        add({ kind: 'db-password', index: m.index!, value })
      }
    }
  }
  return out.sort((a, b) => a.index - b.index)
}

export type SensitiveKind = 'env' | 'git' | 'ssh-key' | 'database-dump' | 'backup' | 'archive' | 'htpasswd' | 'certificate'

/** Files that should almost never be on a public web server. */
export function sensitiveFileKind(path: string): SensitiveKind | null {
  const lower = path.toLowerCase()
  const base = lower.slice(lower.lastIndexOf('/') + 1)
  if (/(^|\/)\.git(\/|$)/.test(lower)) return 'git'
  if (base === '.env' || base.startsWith('.env.')) return 'env'
  if (/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(base) && !base.endsWith('.pub')) return 'ssh-key'
  if (base.endsWith('.pem') || base.endsWith('.p12') || base.endsWith('.pfx')) return 'certificate'
  if (/\.sql(\.gz|\.zip|\.bz2)?$/.test(base)) return 'database-dump'
  if (/\.(bak|backup|old|orig|swp)$/.test(base) || base.endsWith('~')) return 'backup'
  if (/\.(zip|tar|tgz|tar\.gz|rar|7z|gz)$/.test(base)) return 'archive'
  if (base === '.htpasswd') return 'htpasswd'
  return null
}

export const SENSITIVE_TEXT: Record<SensitiveKind, string> = {
  env: 'En .env-fil inneholder vanligvis passord og nøkler, og skal ikke ligge på nettsiden.',
  git: 'Dette er en del av en git-mappe. Den kan avsløre hele historikken til koden.',
  'ssh-key': 'Dette ser ut som en privat SSH-nøkkel. Den gir tilgang til servere og skal aldri deles.',
  certificate: 'Dette ser ut som en sertifikat- eller nøkkelfil, som kan inneholde hemmelige nøkler.',
  'database-dump': 'Dette ser ut som en kopi av en database. Den kan inneholde persondata og passord.',
  backup: 'Dette ser ut som en sikkerhetskopi. Den kan avsløre kildekode eller passord hvis noen laster den ned.',
  archive: 'En komprimert fil (for eksempel .zip) på nettsiden kan lastes ned av hvem som helst. Ofte er det en sikkerhetskopi som ikke skal ut.',
  htpasswd: '.htpasswd inneholder brukernavn og passord. Den skal normalt ligge utenfor nettsidens mappe.'
}

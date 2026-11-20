import { UserError } from '../errors'

export interface ErrorContext {
  host?: string
  port?: number
  protocol?: string
  path?: string
}

const CERT_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID'
])

function codeOf(err: unknown): string | number | undefined {
  if (err && typeof err === 'object' && 'code' in err) return (err as { code: string | number }).code
  return undefined
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? '')
}

/**
 * Translate low level network / FTP / SFTP errors into a friendly Norwegian message with a hint.
 * The original message is never shown (it may contain server details), only matched on.
 */
export function toFriendlyRemoteError(err: unknown, ctx: ErrorContext = {}): UserError {
  if (err instanceof UserError) return err
  const code = codeOf(err)
  const msg = messageOf(err)
  const host = ctx.host ? `«${ctx.host}»` : 'serveren'

  // Wrong username/password
  if (code === 530 || /All configured authentication methods failed|Login incorrect|authentication failed|530/i.test(msg)) {
    return new UserError(
      'Brukernavn eller passord ser ut til å være feil.',
      'Sjekk opplysningene hos webhotellet. Pass på store og små bokstaver, og at det ikke er mellomrom på slutten.'
    )
  }
  if (code === 'HOST_KEY_MISMATCH') {
    return new UserError(
      `Serveren ${host} kjennes ikke igjen. Den har en annen identitet enn sist.`,
      'Det kan skyldes at webhotellet har byttet server, men det kan også være et forsøk på å lure deg. Spør webhotellet før du fortsetter.'
    )
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new UserError(
      `Fant ikke serveren ${host}.`,
      'Sjekk at adressen er skrevet riktig, for eksempel ftp.minside.no, og at Macen er koblet til internett.'
    )
  }
  if (code === 'ECONNREFUSED') {
    return new UserError(
      `Serveren ${host} svarte ikke på port ${ctx.port ?? ''}.`.replace(' .', '.'),
      ctx.protocol === 'sftp'
        ? 'Sjekk at webhotellet tilbyr SFTP, og hvilken port de bruker. Prøv eventuelt vanlig FTP i stedet.'
        : 'Sjekk porten (vanligvis 21 for FTP) og at webhotellet har slått på FTP for kontoen din.'
    )
  }
  if (code === 'ETIMEDOUT' || code === 'TIMEOUT' || /timed? ?out|Timeout/i.test(msg)) {
    if (/handshake/i.test(msg)) {
      return new UserError(
        `Fikk kontakt med ${host}, men den svarte ikke som en SFTP-server.`,
        'Kanskje webhotellet bruker vanlig FTP i stedet. Prøv å bytte tilkobling til FTP, port 21.'
      )
    }
    return new UserError(
      `Fikk ingen kontakt med ${host}.`,
      'Sjekk internettforbindelsen og adressen. Noen nettverk (for eksempel på jobb eller skole) stenger for FTP.'
    )
  }
  if (code === 'ECONNRESET' || code === 'EPIPE' || /socket hang up|closed|ECONNRESET/i.test(msg)) {
    return new UserError(
      'Forbindelsen til serveren ble brutt.',
      'Prøv igjen om litt. Skjer det flere ganger, kan webhotellet ha en grense for hvor mange som kobler til samtidig.'
    )
  }
  if ((typeof code === 'string' && CERT_CODES.has(code)) || /certificate|self.signed/i.test(msg)) {
    return new UserError(
      'Serverens sikkerhetssertifikat kunne ikke bekreftes.',
      'Sjekk at adressen er riktig (bruk gjerne navnet webhotellet oppgir). Hvis webhotellet sier at de bruker et selvlaget sertifikat, kan du slå på "Godta selvlaget sertifikat".'
    )
  }
  if (code === 534 || code === 431 || code === 504 || /AUTH|TLS not available|SSL/i.test(msg)) {
    return new UserError(
      'Serveren støtter ikke kryptert FTP (FTPS).',
      'Prøv vanlig FTP, eller SFTP hvis webhotellet tilbyr det.'
    )
  }
  if (code === 421 || /too many/i.test(msg)) {
    return new UserError(
      'Serveren tar ikke imot flere tilkoblinger akkurat nå.',
      'Vent litt og prøv igjen. Du kan også sette ned antall samtidige tilkoblinger i innstillingene.'
    )
  }
  if (code === 550 || code === 2 || /No such file|not found|550/i.test(msg)) {
    return new UserError(
      ctx.path ? `Fant ikke mappen «${ctx.path}» på serveren, eller du har ikke tilgang til den.` : 'Fant ikke filen eller mappen på serveren.',
      'Velg en annen mappe, eller sjekk tilgangene hos webhotellet.'
    )
  }
  if (code === 3 || /permission denied/i.test(msg)) {
    return new UserError('Du har ikke tilgang til dette på serveren.', 'Sjekk tilgangene for FTP-brukeren hos webhotellet.')
  }
  return new UserError(
    'Noe gikk galt i kontakten med serveren.',
    'Prøv igjen. Hvis det fortsetter, sjekk opplysningene og se loggen.'
  )
}

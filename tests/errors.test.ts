import { describe, it, expect } from 'vitest'
import { redact, toSerializedError, UserError } from '../src/core/errors'

describe('errors', () => {
  it('redacts known secrets, URL credentials and FTP PASS commands', () => {
    expect(redact('feil med hemmelig123 her', ['hemmelig123'])).toBe('feil med •••• her')
    expect(redact('ftp://bruker:pw@ftp.no/x')).toBe('ftp://bruker:••••@ftp.no/x')
    expect(redact('> PASS topsecret')).toBe('> PASS ••••')
  })
  it('hides non-user errors behind a generic message', () => {
    expect(toSerializedError(new Error('ECONNRESET at secret path')).message).not.toContain('ECONNRESET')
    expect(toSerializedError(new UserError('Feil passord', 'Sjekk'))).toEqual({ message: 'Feil passord', hint: 'Sjekk' })
  })
})

import { describe, it, expect } from 'vitest'
import { toFriendlyRemoteError } from '../src/core/remote/friendlyErrors'

const err = (message: string, code?: string | number) => Object.assign(new Error(message), code !== undefined ? { code } : {})

describe('friendly remote errors', () => {
  it.each([
    [err('530 Login incorrect', 530), /Brukernavn eller passord/],
    [err('All configured authentication methods failed'), /Brukernavn eller passord/],
    [err('getaddrinfo ENOTFOUND ftp.x.no', 'ENOTFOUND'), /Fant ikke serveren/],
    [err('connect ECONNREFUSED', 'ECONNREFUSED'), /svarte ikke/],
    [err('Timed out', 'TIMEOUT'), /ingen kontakt/],
    [err('Timed out while waiting for handshake'), /SFTP-server/],
    [err('self-signed certificate', 'DEPTH_ZERO_SELF_SIGNED_CERT'), /sertifikat/],
    [err('534 AUTH not supported', 534), /kryptert/],
    [err('421 Too many connections', 421), /flere tilkoblinger/],
    [err('550 No such file', 550), /Fant ikke/]
  ])('maps %s', (e, expected) => {
    const f = toFriendlyRemoteError(e, { host: 'ftp.x.no', port: 21 })
    expect(f.message).toMatch(expected)
    expect(f.hint).toBeTruthy()
  })

  it('never echoes the raw server message', () => {
    const f = toFriendlyRemoteError(err('weird thing PASS hunter2'))
    expect(f.message + (f.hint ?? '')).not.toContain('hunter2')
  })
})

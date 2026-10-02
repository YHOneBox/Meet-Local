import { describe, expect, it } from 'vitest'
import { fingerprintFromDer, fingerprintFromPem, sameSiteHost, secretsMatch } from '../electron/security'

describe('meeting protection', () => {
  it('identifies a certificate by its SHA-256 fingerprint', () => {
    const pem = `-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----`
    const der = Buffer.from('MIIB', 'base64')
    expect(fingerprintFromPem(pem)).toBe(fingerprintFromDer(der))
    expect(fingerprintFromPem(pem)).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/)
  })

  it('compares secrets without accepting a different length', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true)
    expect(secretsMatch('abc', 'abd')).toBe(false)
    expect(secretsMatch('abc', 'abcd')).toBe(false)
    expect(sameSiteHost(undefined, '127.0.0.1:47321')).toBe(true)
    expect(sameSiteHost('https://127.0.0.1:47321', '127.0.0.1:47321')).toBe(true)
    expect(sameSiteHost('https://evil.example', '127.0.0.1:47321')).toBe(false)
  })
})

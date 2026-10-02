import { describe, expect, it } from 'vitest'
import { classifyInterface, friendlyInterfaceLabel } from '../shared/network'
import { buildShareUrl, generatePassword, hostHidesAddress, parseMeetingLink, passwordStrength, visibleShareUrl, websocketUrl } from '../shared/urls'

describe('network classification', () => {
  it('recognizes VPN adapters and Tailscale addresses', () => {
    expect(classifyInterface('Tailscale', '100.88.12.4', 'IPv4')).toBe('vpn')
    expect(classifyInterface('eth0', '100.64.0.2', 'IPv4')).toBe('vpn')
    expect(classifyInterface('wg0', '10.8.0.2', 'IPv4')).toBe('vpn')
    expect(friendlyInterfaceLabel('Tailscale', 'vpn')).toBe('Tailscale')
  })

  it('recognizes local network addresses and skips loopback', () => {
    expect(classifyInterface('Ethernet', '192.168.1.20', 'IPv4')).toBe('lan')
    expect(classifyInterface('en0', '10.0.0.8', 'IPv4')).toBe('lan')
    expect(classifyInterface('lo', '127.0.0.1', 'IPv4')).toBe('skip')
    expect(classifyInterface('eth0', '169.254.2.2', 'IPv4')).toBe('skip')
  })
})

describe('passwords and links', () => {
  it('generates a complex password', () => {
    const password = generatePassword()
    expect(password.length).toBe(18)
    expect(password).toMatch(/[a-z]/)
    expect(password).toMatch(/[A-Z]/)
    expect(password).toMatch(/[0-9]/)
    expect(password).toMatch(/[^A-Za-z0-9]/)
    expect(passwordStrength(password)).toBe(4)
    expect(passwordStrength('short')).toBeLessThan(4)
  })

  it('builds and parses meeting links', () => {
    const temp = buildShareUrl('100.64.1.5', 47321, 'temp', 'abcDEF234567')
    expect(temp).toBe('https://100.64.1.5:47321/t/abcDEF234567')
    expect(parseMeetingLink(temp, 'https://127.0.0.1')).toEqual({
      httpBase: 'https://100.64.1.5:47321',
      tempToken: 'abcDEF234567',
    })
    expect(hostHidesAddress('blue-harbor.trycloudflare.com')).toBe(true)
    expect(hostHidesAddress('192.168.1.20')).toBe(false)
    expect(hostHidesAddress('uljtt-30-47-152-61.run.example')).toBe(false)
    expect(visibleShareUrl('https://blue-harbor.trycloudflare.com/t/newtoken', 'https://192.168.1.20:47321/t/oldtoken')).toBe(
      'https://blue-harbor.trycloudflare.com/t/newtoken',
    )
    const network = buildShareUrl('192.168.0.8', 443, 'network', 'abcdefghij')
    expect(parseMeetingLink(network, 'https://127.0.0.1')?.meetingId).toBe('abcdefghij')
    expect(parseMeetingLink('not a link', 'https://127.0.0.1:1')).toBeNull()
    expect(websocketUrl('https://127.0.0.1:47999')).toBe('wss://127.0.0.1:47999/ws')
    expect(buildShareUrl('fe80::1', 1, 'network', 'abcdefghij')).toContain('[fe80::1]')
  })
})

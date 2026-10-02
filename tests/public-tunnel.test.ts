import { describe, expect, it } from 'vitest'
import { readTunnelUrl } from '../electron/public-tunnel'

describe('public temporary address', () => {
  it('reads a Cloudflare address and ignores one that contains an IP', () => {
    const log = 'INF Requesting new quick Tunnel\nINF https://blue-harbor.trycloudflare.com\n'
    expect(readTunnelUrl(log)).toBe('https://blue-harbor.trycloudflare.com')
    expect(readTunnelUrl('https://10.1.2.3.trycloudflare.com')).toBeNull()
    expect(readTunnelUrl('no address yet')).toBeNull()
  })
})

import type { InterfaceKind } from './protocol'

const VPN_NAME =
  /tailscale|wireguard|\bwg\d|\btun\d|\btap\d|utun|wintun|nordlynx|zerotier|hamachi|openvpn|ipsec|vpn|ppp|ciscod|anyconnect|proton|mullvad|warp|outline|amnezia/i

export function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false
  const [a, b] = parts
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

export function isTailscaleIPv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false
  const [a, b] = parts
  return a === 100 && b >= 64 && b <= 127
}

export function classifyInterface(name: string, address: string, family: string): InterfaceKind | 'skip' {
  const lowerFamily = family.toLowerCase()
  const ipv4 = lowerFamily === 'ipv4' || lowerFamily === '4'
  const ipv6 = lowerFamily === 'ipv6' || lowerFamily === '6'
  if (!ipv4 && !ipv6) return 'skip'
  if (address.startsWith('fe80:') || address.startsWith('169.254.')) return 'skip'
  if (address === '::1' || address === '127.0.0.1') return 'skip'
  if (ipv6 && address.startsWith('fc') === false && address.startsWith('fd') === false && !address.includes(':')) {
    return 'skip'
  }
  if (VPN_NAME.test(name) || (ipv4 && isTailscaleIPv4(address))) return 'vpn'
  if (ipv4 && isPrivateIPv4(address)) return 'lan'
  if (ipv6 && (address.startsWith('fc') || address.startsWith('fd'))) return 'lan'
  return 'other'
}

export function friendlyInterfaceLabel(name: string, kind: InterfaceKind): string {
  if (/tailscale/i.test(name)) return 'Tailscale'
  if (/wireguard|\bwg\d/i.test(name)) return 'WireGuard'
  if (/nordlynx|nordvpn/i.test(name)) return 'NordVPN'
  if (/zerotier/i.test(name)) return 'ZeroTier'
  if (/proton/i.test(name)) return 'Proton VPN'
  if (/mullvad/i.test(name)) return 'Mullvad'
  if (/warp/i.test(name)) return 'Cloudflare WARP'
  if (/wi-?fi|wlan|wireless/i.test(name)) return kind === 'vpn' ? 'VPN over Wi-Fi' : 'Wi-Fi'
  if (/ethernet|^eth\d|^en\d/i.test(name)) return kind === 'vpn' ? 'VPN' : 'Ethernet'
  if (kind === 'vpn') return 'VPN'
  if (kind === 'lan') return 'Local network'
  return 'Network'
}

import type { LinkMode } from './protocol'

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const SYMBOLS = '!@#$%^&*-_=+?'

function randomInt(max: number): number {
  const values = new Uint32Array(1)
  globalThis.crypto.getRandomValues(values)
  return values[0] % max
}

export function generatePassword(length = 18): string {
  const sets = [ALPHABET.slice(0, 23), ALPHABET.slice(23, 45), '23456789', SYMBOLS]
  const chars = sets.map((set) => set[randomInt(set.length)])
  const all = sets.join('')
  while (chars.length < length) chars.push(all[randomInt(all.length)])
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1)
    const swap = chars[i]
    chars[i] = chars[j]
    chars[j] = swap
  }
  return chars.join('')
}

export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length < 4) return 0
  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 14) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1
  return Math.min(score, 4) as 0 | 1 | 2 | 3 | 4
}

export const STRENGTH_LABEL = ['Too short', 'Weak', 'Okay', 'Strong', 'Complex'] as const

export function formatHost(address: string): string {
  return address.includes(':') ? `[${address}]` : address
}

export function buildShareUrl(address: string, port: number, mode: LinkMode, idOrToken: string, scheme: 'http' | 'https' = 'https'): string {
  const path = mode === 'temp' ? `/t/${idOrToken}` : `/m/${idOrToken}`
  return `${scheme}://${formatHost(address)}:${port}${path}`
}

export type ParsedLink = {
  httpBase: string
  meetingId?: string
  tempToken?: string
}

export function parseMeetingLink(input: string, fallbackOrigin: string): ParsedLink | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `${fallbackOrigin.replace(/\/$/, '')}/${trimmed.replace(/^\//, '')}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2) return null
  if (parts[0] !== 'm' && parts[0] !== 't') return null
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(parts[1])) return null
  const httpBase = `${url.protocol}//${url.host}`
  if (parts[0] === 'm') return { httpBase, meetingId: parts[1] }
  return { httpBase, tempToken: parts[1] }
}

export function websocketUrl(httpBase: string): string {
  const url = new URL(httpBase)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws'
  url.search = ''
  url.hash = ''
  return url.toString()
}

import { createHash, timingSafeEqual } from 'node:crypto'
import tls from 'node:tls'

export function fingerprintFromDer(der: Buffer): string {
  return createHash('sha256').update(der).digest('hex').toUpperCase().match(/.{2}/g)?.join(':') ?? ''
}

export function fingerprintFromPem(pem: string): string {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  return fingerprintFromDer(Buffer.from(body, 'base64'))
}

export function isFingerprint(value: string): boolean {
  return /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/.test(value)
}

export function secretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function sameSiteHost(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export function readPeerFingerprint(urlString: string): Promise<{ host: string; fingerprint: string }> {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return Promise.reject(new Error('That meeting link is not valid.'))
  }
  if (url.protocol !== 'https:') return Promise.reject(new Error('A meeting link has to use HTTPS.'))
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const port = Number(url.port || 443)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.reject(new Error('That link has no valid port.'))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, value?: { host: string; fingerprint: string }) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else if (value) resolve(value)
    }
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      const certificate = socket.getPeerCertificate()
      socket.end()
      if (!certificate.raw || certificate.raw.length === 0) {
        finish(new Error('The meeting computer did not present a certificate.'))
        return
      }
      finish(undefined, { host, fingerprint: fingerprintFromDer(certificate.raw) })
    })
    socket.setTimeout(8000, () => {
      socket.destroy()
      finish(new Error('The meeting computer did not answer.'))
    })
    socket.on('error', () => finish(new Error('The meeting computer could not be reached.')))
  })
}

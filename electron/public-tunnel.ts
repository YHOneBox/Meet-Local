import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { isAllowedDownloadHost } from '../shared/updates'
import { hostHidesAddress } from '../shared/urls'

const VERSION = '2026.9.3'
const RELEASE = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}`

const ASSETS: Record<string, { file: string; sha256: string; packed: boolean }> = {
  'win32-x64': {
    file: 'cloudflared-windows-amd64.exe',
    sha256: 'f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2',
    packed: false,
  },
  'darwin-x64': {
    file: 'cloudflared-darwin-amd64.tgz',
    sha256: 'ab588b3b4db9cdb4476c30a3db2a72635b1d8327d44741fee6799a0f37b0ec07',
    packed: true,
  },
  'darwin-arm64': {
    file: 'cloudflared-darwin-arm64.tgz',
    sha256: '5472c1a01c84bc31b3021056a73b4e5774ddddefc572124ea8fdf6c340639f32',
    packed: true,
  },
  'linux-x64': {
    file: 'cloudflared-linux-amd64',
    sha256: '77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2',
    packed: false,
  },
  'linux-arm64': {
    file: 'cloudflared-linux-arm64',
    sha256: 'aaeb2d7d0da3614634c7e03ab13487a1522c2e79165ed2929cfe23d5e95b326d',
    packed: false,
  },
}

export function readTunnelUrl(text: string): string | null {
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
  if (!match) return null
  try {
    const url = new URL(match[0])
    if (url.protocol !== 'https:' || !hostHidesAddress(url.hostname)) return null
    return url.origin
  } catch {
    return null
  }
}

function assetFor(platform: string, arch: string) {
  const key = `${platform}-${arch === 'arm64' ? 'arm64' : 'x64'}`
  if (platform === 'win32' && arch === 'arm64') return null
  return ASSETS[key] || null
}

function request(url: string): Promise<http.IncomingMessage> {
  if (!isAllowedDownloadHost(url)) return Promise.reject(new Error('The address helper left GitHub.'))
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http
    const req = client.get(url, { headers: { 'User-Agent': 'MeetLocal' } }, (response) => resolve(response))
    req.setTimeout(30000, () => req.destroy(new Error('The address helper download stalled.')))
    req.on('error', reject)
  })
}

async function follow(url: string, hops = 0): Promise<http.IncomingMessage> {
  if (hops > 5) throw new Error('The address helper download was redirected too many times.')
  const response = await request(url)
  const status = response.statusCode || 0
  if (status >= 300 && status < 400 && response.headers.location) {
    response.resume()
    return follow(new URL(response.headers.location, url).toString(), hops + 1)
  }
  if (status >= 400) {
    response.resume()
    throw new Error('The address helper could not be downloaded.')
  }
  return response
}

async function downloadFile(url: string, destination: string, sha256: string) {
  const response = await follow(url)
  const file = await fs.open(destination, 'w')
  const hash = createHash('sha256')
  let received = 0
  try {
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      received += buffer.length
      if (received > 80 * 1024 * 1024) throw new Error('The address helper download is larger than expected.')
      hash.update(buffer)
      await file.write(buffer)
    }
  } finally {
    await file.close()
  }
  if (hash.digest('hex') !== sha256) {
    await fs.rm(destination, { force: true })
    throw new Error('The address helper download did not match its checksum.')
  }
}

async function binaryPath(dataDir: string, platform = process.platform, arch = process.arch): Promise<string> {
  const asset = assetFor(platform, arch)
  if (!asset) throw new Error('A temporary public address is not available for this computer.')
  const dir = path.join(dataDir, 'bin')
  await fs.mkdir(dir, { recursive: true })
  const binary = path.join(dir, platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
  try {
    await fs.access(binary)
    return binary
  } catch {
    /* download the pinned release */
  }
  const packed = path.join(dir, asset.file)
  await downloadFile(`${RELEASE}/${asset.file}`, packed, asset.sha256)
  if (asset.packed) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('tar', ['-xzf', packed, '-C', dir], { windowsHide: true, stdio: 'ignore' })
      child.on('error', reject)
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('The address helper could not be unpacked.'))))
    })
    await fs.rm(packed, { force: true })
  } else if (packed !== binary) {
    await fs.rename(packed, binary)
  }
  if (platform !== 'win32') await fs.chmod(binary, 0o755)
  return binary
}

function stop(child: ChildProcess) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    return
  }
  child.kill('SIGTERM')
}

export async function openPublicTunnel(options: { port: number; https: boolean; dataDir?: string }): Promise<{ url: string; close: () => void }> {
  const dataDir = options.dataDir || path.join(os.tmpdir(), 'meetlocal-cloudflared')
  const binary = await binaryPath(dataDir)
  const origin = `${options.https ? 'https' : 'http'}://127.0.0.1:${options.port}`
  const args = ['tunnel', '--no-autoupdate', '--url', origin]
  if (options.https) args.push('--no-tls-verify')
  const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let settled = false
  const close = () => {
    settled = true
    stop(child)
  }
  return new Promise((resolve, reject) => {
    let output = ''
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      stop(child)
      reject(error)
    }
    const timer = setTimeout(() => fail(new Error('The temporary address took too long to appear.')), 25000)
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      const url = readTunnelUrl(output)
      if (!url || settled) return
      settled = true
      clearTimeout(timer)
      resolve({ url, close })
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (error) => fail(error))
    child.on('exit', (code) => {
      if (!settled) fail(new Error(output.trim() || `The temporary address stopped (${code ?? 'unknown'}).`))
    })
  })
}

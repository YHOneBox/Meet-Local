import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import selfsigned from 'selfsigned'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { classifyInterface, friendlyInterfaceLabel } from '../shared/network'
import {
  MAX_PEERS,
  REACTIONS,
  type ChatMessage,
  type ClientMessage,
  type HostAction,
  type InterfaceKind,
  type LinkMode,
  type MeetingPublic,
  type PeerInfo,
  type ReactionEmoji,
  type ServerMessage,
  type ShareLink,
  type SignalData,
} from '../shared/protocol'
import { buildShareUrl } from '../shared/urls'

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const TOKEN_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

type AliveSocket = WebSocket & { isAlive?: boolean }

type Peer = {
  id: string
  name: string
  ws: AliveSocket
  waiting: boolean
  mic: boolean
  cam: boolean
  sharing: boolean
  raised: boolean
  isHost: boolean
  ip: string
}

type Meeting = {
  id: string
  title: string
  passwordHash: string | null
  tempToken: string
  hostSecret: string
  linkMode: LinkMode
  locked: boolean
  waitingRoom: boolean
  allowStun: boolean
  createdAt: number
  peers: Map<string, Peer>
  chat: ChatMessage[]
}

export type InterfaceRecord = {
  name: string
  label: string
  address: string
  kind: InterfaceKind
}

export type CreateMeetingInput = {
  title?: string
  password?: string
  waitingRoom?: boolean
  linkMode?: LinkMode
  allowStun?: boolean
  preferredAddress?: string
}

export type CreateMeetingResult = {
  meetingId: string
  tempToken: string
  hostSecret: string
  linkMode: LinkMode
  title: string
  requiresPassword: boolean
  waitingRoom: boolean
  allowStun: boolean
  port: number
  enterPath: string
  fingerprint: string
  links: ShareLink[]
}

export type ServerOptions = {
  port?: number
  listenHost?: string
  tls?: boolean
  staticDir?: string
  dev?: boolean
  projectRoot?: string
}

export type RunningServer = {
  port: number
  fingerprint: string
  close: () => Promise<void>
}

const meetings = new Map<string, Meeting>()
const tokens = new Map<string, string>()
const tombstones = new Map<string, number>()
const passwordFailures = new Map<string, { count: number; resetAt: number }>()

function randomString(length: number, alphabet: string): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length]
  return out
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32).toString('hex')
  return `${salt}:${hash}`
}

function checkPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const actual = scryptSync(password, salt, 32)
  const expected = Buffer.from(hash, 'hex')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

export function listInterfaces(): InterfaceRecord[] {
  const records: InterfaceRecord[] = []
  const nets = os.networkInterfaces()
  for (const [name, entries] of Object.entries(nets)) {
    for (const entry of entries ?? []) {
      const family = String(entry.family)
      const kind = classifyInterface(name, entry.address, family)
      const ipv4 = family.toLowerCase() === 'ipv4' || family === '4'
      if (kind === 'skip' || entry.internal || !ipv4) continue
      records.push({
        name,
        label: friendlyInterfaceLabel(name, kind),
        address: entry.address,
        kind,
      })
    }
  }
  const rank: Record<InterfaceKind, number> = { vpn: 0, lan: 1, other: 2 }
  records.sort((a, b) => rank[a.kind] - rank[b.kind] || a.label.localeCompare(b.label) || a.address.localeCompare(b.address))
  return records
}

function cleanName(input: string): string | null {
  const name = input.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)
  return name.length > 0 ? name : null
}

function publicMeeting(meeting: Meeting, includeToken: boolean): MeetingPublic & { meetingId: string; tempToken: string | null } {
  return {
    meetingId: meeting.id,
    title: meeting.title,
    linkMode: meeting.linkMode,
    locked: meeting.locked,
    waitingRoom: meeting.waitingRoom,
    allowStun: meeting.allowStun,
    requiresPassword: meeting.passwordHash !== null,
    tempToken: includeToken && meeting.linkMode === 'temp' ? meeting.tempToken : null,
  }
}

function peerInfo(peer: Peer): PeerInfo {
  return {
    id: peer.id,
    name: peer.name,
    mic: peer.mic,
    cam: peer.cam,
    sharing: peer.sharing,
    raised: peer.raised,
    isHost: peer.isHost,
    waiting: peer.waiting,
  }
}

function admitted(meeting: Meeting): Peer[] {
  return [...meeting.peers.values()].filter((peer) => !peer.waiting)
}

function waiting(meeting: Meeting): Peer[] {
  return [...meeting.peers.values()].filter((peer) => peer.waiting)
}

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
}

function broadcast(meeting: Meeting, message: ServerMessage, exceptId?: string) {
  for (const peer of admitted(meeting)) {
    if (peer.id !== exceptId) send(peer.ws, message)
  }
}

function sendWaiting(meeting: Meeting) {
  const list = waiting(meeting).map(peerInfo)
  for (const peer of admitted(meeting)) {
    if (peer.isHost) send(peer.ws, { type: 'waiting-list', waiting: list })
  }
}

function rememberTombstone(key: string) {
  tombstones.set(key, Date.now() + 30 * 60 * 1000)
}

function tombstoneHit(key: string | undefined): boolean {
  if (!key) return false
  const expiry = tombstones.get(key)
  if (!expiry) return false
  if (expiry < Date.now()) {
    tombstones.delete(key)
    return false
  }
  return true
}

function shareLinks(meeting: Meeting, port: number, scheme: 'http' | 'https'): ShareLink[] {
  const key = meeting.linkMode === 'temp' ? meeting.tempToken : meeting.id
  return listInterfaces().map((item) => ({
    name: item.name,
    label: item.label,
    address: item.address,
    kind: item.kind,
    url: buildShareUrl(item.address, port, meeting.linkMode, key, scheme),
  }))
}

function enterPath(meeting: Meeting): string {
  return meeting.linkMode === 'temp' ? `/t/${meeting.tempToken}` : `/m/${meeting.id}`
}

function findMeeting(meetingId?: string, tempToken?: string): { meeting: Meeting | null; ended: boolean } {
  if (tempToken) {
    const id = tokens.get(tempToken)
    const meeting = id ? meetings.get(id) : undefined
    if (meeting && meeting.linkMode === 'temp' && meeting.tempToken === tempToken) return { meeting, ended: false }
    return { meeting: null, ended: tombstoneHit(tempToken) }
  }
  if (meetingId) {
    const meeting = meetings.get(meetingId)
    if (meeting && meeting.linkMode === 'network') return { meeting, ended: false }
    return { meeting: null, ended: tombstoneHit(meetingId) }
  }
  return { meeting: null, ended: false }
}

function endMeeting(meeting: Meeting) {
  rememberTombstone(meeting.id)
  rememberTombstone(meeting.tempToken)
  tokens.delete(meeting.tempToken)
  for (const peer of meeting.peers.values()) {
    send(peer.ws, { type: 'meeting-ended' })
    peer.ws.close()
  }
  meetings.delete(meeting.id)
}

function snapshot(meeting: Meeting, self: Peer): ServerMessage {
  return {
    type: self.waiting ? 'waiting' : 'joined',
    self: peerInfo(self),
    meeting: publicMeeting(meeting, self.isHost),
    participants: admitted(meeting)
      .filter((peer) => peer.id !== self.id)
      .map(peerInfo),
    waiting: self.isHost ? waiting(meeting).map(peerInfo) : [],
    chat: meeting.chat.slice(-100),
  }
}

function rateKey(meetingId: string, ip: string) {
  return `${meetingId}:${ip}`
}

function tooManyFailures(meetingId: string, ip: string): boolean {
  const entry = passwordFailures.get(rateKey(meetingId, ip))
  if (!entry) return false
  if (entry.resetAt < Date.now()) {
    passwordFailures.delete(rateKey(meetingId, ip))
    return false
  }
  return entry.count >= 8
}

function markFailure(meetingId: string, ip: string) {
  const key = rateKey(meetingId, ip)
  const current = passwordFailures.get(key)
  if (!current || current.resetAt < Date.now()) {
    passwordFailures.set(key, { count: 1, resetAt: Date.now() + 60_000 })
    return
  }
  current.count += 1
}

function hostGuard(meeting: Meeting, secret: string | undefined): boolean {
  return Boolean(secret) && secret === meeting.hostSecret
}

function applyHost(meeting: Meeting, peer: Peer, action: HostAction, targetId?: string, enabled?: boolean, port = 0) {
  if (!peer.isHost) return
  if (action === 'end') {
    endMeeting(meeting)
    return
  }
  if (action === 'lock') {
    meeting.locked = enabled !== false
    broadcast(meeting, { type: 'meeting-updated', meeting: publicMeeting(meeting, false) })
    for (const host of admitted(meeting).filter((item) => item.isHost)) {
      send(host.ws, { type: 'meeting-updated', meeting: publicMeeting(meeting, true) })
    }
    return
  }
  if (action === 'waiting-room') {
    meeting.waitingRoom = Boolean(enabled)
    broadcast(meeting, { type: 'meeting-updated', meeting: publicMeeting(meeting, false) })
    for (const host of admitted(meeting).filter((item) => item.isHost)) {
      send(host.ws, { type: 'meeting-updated', meeting: publicMeeting(meeting, true) })
    }
    return
  }
  if (action === 'regenerate-temp') {
    tokens.delete(meeting.tempToken)
    rememberTombstone(meeting.tempToken)
    meeting.tempToken = randomString(24, TOKEN_ALPHABET)
    tokens.set(meeting.tempToken, meeting.id)
    for (const host of admitted(meeting).filter((item) => item.isHost)) {
      send(host.ws, { type: 'temp-token', tempToken: meeting.tempToken })
      send(host.ws, { type: 'meeting-updated', meeting: publicMeeting(meeting, true) })
    }
    return
  }
  const target = targetId ? meeting.peers.get(targetId) : undefined
  if (!target || target.id === peer.id) return
  if (action === 'mute') {
    target.mic = false
    send(target.ws, { type: 'force-mute' })
    broadcast(meeting, { type: 'peer-state', participant: peerInfo(target) })
    return
  }
  if (action === 'remove') {
    send(target.ws, { type: 'removed' })
    target.ws.close()
    return
  }
  if (action === 'deny') {
    meeting.peers.delete(target.id)
    send(target.ws, { type: 'denied' })
    target.ws.close()
    sendWaiting(meeting)
    return
  }
  if (action === 'admit') {
    if (!target.waiting) return
    if (admitted(meeting).length >= MAX_PEERS) {
      send(peer.ws, { type: 'error', code: 'full', message: 'This meeting is full.' })
      return
    }
    target.waiting = false
    const others = admitted(meeting).filter((item) => item.id !== target.id)
    send(target.ws, {
      type: 'admitted',
      self: peerInfo(target),
      meeting: publicMeeting(meeting, false),
      participants: others.map(peerInfo),
      waiting: [],
      chat: meeting.chat.slice(-100),
    })
    broadcast(meeting, { type: 'peer-joined', participant: peerInfo(target) }, target.id)
    sendWaiting(meeting)
  }
  void port
}

function handleSocket(ws: AliveSocket, ip: string) {
  ws.isAlive = true
  ws.on('pong', () => {
    ws.isAlive = true
  })
  let peer: Peer | null = null
  let meeting: Meeting | null = null

  const fail = (code: string, message: string) => {
    send(ws, { type: 'error', code, message })
    ws.close()
  }

  ws.on('message', (raw: RawData) => {
    let message: ClientMessage
    try {
      message = JSON.parse(raw.toString()) as ClientMessage
    } catch {
      return
    }
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') return

    if (message.type === 'join') {
      if (peer) return
      const name = cleanName(message.name || '')
      if (!name) {
        fail('name', 'Enter your name to join.')
        return
      }
      const found = findMeeting(message.meetingId, message.tempToken)
      if (!found.meeting) {
        fail(found.ended ? 'ended' : 'not-found', found.ended ? 'This meeting has ended.' : 'This meeting link does not exist.')
        return
      }
      meeting = found.meeting
      if (tooManyFailures(meeting.id, ip)) {
        fail('rate-limited', 'Too many attempts. Wait a moment and try again.')
        return
      }
      const isHost = hostGuard(meeting, message.hostSecret)
      if (meeting.passwordHash && !isHost) {
        if (!message.password || !checkPassword(message.password, meeting.passwordHash)) {
          markFailure(meeting.id, ip)
          fail('bad-password', 'That password is not right.')
          return
        }
      }
      if (meeting.locked && !isHost) {
        fail('locked', 'The host has locked this meeting.')
        return
      }
      const hold = Boolean(meeting.waitingRoom && !isHost)
      if (!hold && admitted(meeting).length >= MAX_PEERS) {
        fail('full', 'This meeting is full (8 people).')
        return
      }
      peer = {
        id: randomString(12, ID_ALPHABET),
        name,
        ws,
        waiting: hold,
        mic: true,
        cam: true,
        sharing: false,
        raised: false,
        isHost,
        ip,
      }
      meeting.peers.set(peer.id, peer)
      if (hold) {
        send(ws, { type: 'waiting' })
        sendWaiting(meeting)
        return
      }
      send(ws, snapshot(meeting, peer))
      broadcast(meeting, { type: 'peer-joined', participant: peerInfo(peer) }, peer.id)
      return
    }

    if (!peer || !meeting || peer.waiting) return

    if (message.type === 'signal') {
      const target = meeting.peers.get(message.to)
      if (!target || target.waiting) return
      const data = message.data as SignalData
      if (!data || typeof data !== 'object') return
      send(target.ws, { type: 'signal', from: peer.id, data })
      return
    }

    if (message.type === 'chat') {
      const text = String(message.text || '')
        .replace(/[\u0000-\u0008]/g, '')
        .trim()
        .slice(0, 2000)
      if (!text) return
      const chat: ChatMessage = {
        id: randomString(10, ID_ALPHABET),
        fromId: peer.id,
        fromName: peer.name,
        text,
        at: Date.now(),
      }
      meeting.chat.push(chat)
      if (meeting.chat.length > 200) meeting.chat.splice(0, meeting.chat.length - 200)
      broadcast(meeting, { type: 'chat', message: chat })
      return
    }

    if (message.type === 'state') {
      peer.mic = Boolean(message.mic)
      peer.cam = Boolean(message.cam)
      peer.sharing = Boolean(message.sharing)
      peer.raised = Boolean(message.raised)
      broadcast(meeting, { type: 'peer-state', participant: peerInfo(peer) })
      return
    }

    if (message.type === 'reaction') {
      const emoji = REACTIONS.find((item) => item === message.emoji)
      if (!emoji) return
      broadcast(meeting, { type: 'reaction', fromId: peer.id, fromName: peer.name, emoji: emoji as ReactionEmoji })
      return
    }

    if (message.type === 'host') {
      applyHost(meeting, peer, message.action, message.targetId, message.enabled)
    }
  })

  ws.on('close', () => {
    if (!peer || !meeting) return
    const current = meetings.get(meeting.id)
    if (!current) return
    current.peers.delete(peer.id)
    if (!peer.waiting) broadcast(current, { type: 'peer-left', id: peer.id })
    else sendWaiting(current)
  })
}

function createCertificate(ips: string[]) {
  const altNames: Array<{ type: number; value?: string; ip?: string }> = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
  ]
  for (const ip of ips) {
    if (ip.includes(':')) continue
    altNames.push({ type: 7, ip })
  }
  const pems = selfsigned.generate([{ name: 'commonName', value: 'MeetLocal' }], {
    algorithm: 'sha256',
    days: 365,
    keySize: 2048,
    notBeforeDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  })
  const der = Buffer.from(pems.cert.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64')
  const fingerprint = createHash('sha256').update(der).digest('hex').toUpperCase().match(/.{2}/g)?.join(':') ?? ''
  return { key: pems.private, cert: pems.cert, fingerprint }
}

function readBody(req: Request): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 256_000) {
        reject(new Error('too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      } catch {
        reject(new Error('bad-json'))
      }
    })
    req.on('error', reject)
  })
}

function isSpaPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/join' || pathname === '/room' || pathname.startsWith('/m/') || pathname.startsWith('/t/')
}

async function sendIndex(
  res: Response,
  devServer: { transformIndexHtml: (url: string, html: string) => Promise<string> } | null,
  staticDir: string,
  projectRoot: string,
  url: string,
) {
  if (!devServer) {
    res.sendFile(path.join(staticDir, 'index.html'))
    return
  }
  const template = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8')
  const html = await devServer.transformIndexHtml(url, template)
  res.status(200).set({ 'Content-Type': 'text/html' }).end(html)
}

export async function startMeetServer(options: ServerOptions = {}): Promise<RunningServer> {
  const dev = Boolean(options.dev)
  const scheme: 'http' | 'https' = options.tls === false ? 'http' : 'https'
  const projectRoot = options.projectRoot ?? process.cwd()
  const staticDir = options.staticDir ?? path.join(projectRoot, 'dist')
  let boundPort = options.port ?? 0
  const app = express()
  app.disable('x-powered-by')
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', _req.headers.origin || '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Host-Secret')
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (_req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    next()
  })

  type ViteDev = {
    middlewares: express.RequestHandler
    transformIndexHtml: (url: string, html: string) => Promise<string>
    close: () => Promise<void>
  }
  let vite: ViteDev | null = null
  if (dev) {
    const { createServer: createVite } = await import('vite')
    vite = (await createVite({
      root: projectRoot,
      server: { middlewareMode: true },
      appType: 'custom',
    })) as unknown as ViteDev
  }

  const cert = createCertificate(listInterfaces().map((item) => item.address))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, fingerprint: cert.fingerprint })
  })

  app.get('/api/session', (req, res) => {
    res.json({
      canHost: isLoopbackAddress(req.socket.remoteAddress),
      interfaces: listInterfaces(),
      fingerprint: cert.fingerprint,
    })
  })

  app.get('/api/info', (req, res) => {
    const meetingId = typeof req.query.meetingId === 'string' ? req.query.meetingId : undefined
    const tempToken = typeof req.query.tempToken === 'string' ? req.query.tempToken : undefined
    const found = findMeeting(meetingId, tempToken)
    if (!found.meeting) {
      res.status(404).json({ error: found.ended ? 'ended' : 'not-found' })
      return
    }
    const secret = req.header('x-host-secret')
    const isHost = hostGuard(found.meeting, secret)
    res.json({
      ...publicMeeting(found.meeting, isHost),
      isHost,
      fingerprint: cert.fingerprint,
    })
  })

  app.post('/api/meetings', async (req, res) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'host-only' })
      return
    }
    let body: Record<string, unknown>
    try {
      body = await readBody(req)
    } catch {
      res.status(400).json({ error: 'bad-json' })
      return
    }
    const title = cleanName(String(body.title || 'Meeting')) || 'Meeting'
    const password = typeof body.password === 'string' ? body.password.trim().slice(0, 128) : ''
    const linkMode: LinkMode = body.linkMode === 'temp' ? 'temp' : 'network'
    const meeting: Meeting = {
      id: randomString(10, ID_ALPHABET),
      title,
      passwordHash: password ? hashPassword(password) : null,
      tempToken: randomString(24, TOKEN_ALPHABET),
      hostSecret: randomBytes(32).toString('hex'),
      linkMode,
      locked: false,
      waitingRoom: Boolean(body.waitingRoom),
      allowStun: body.allowStun !== false,
      createdAt: Date.now(),
      peers: new Map(),
      chat: [],
    }
    meetings.set(meeting.id, meeting)
    tokens.set(meeting.tempToken, meeting.id)
    const preferred = typeof body.preferredAddress === 'string' ? body.preferredAddress : ''
    const links = shareLinks(meeting, boundPort, scheme)
    links.sort((a, b) => Number(b.address === preferred) - Number(a.address === preferred))
    const result: CreateMeetingResult = {
      meetingId: meeting.id,
      tempToken: meeting.tempToken,
      hostSecret: meeting.hostSecret,
      linkMode: meeting.linkMode,
      title: meeting.title,
      requiresPassword: meeting.passwordHash !== null,
      waitingRoom: meeting.waitingRoom,
      allowStun: meeting.allowStun,
      port: boundPort,
      enterPath: enterPath(meeting),
      fingerprint: cert.fingerprint,
      links,
    }
    res.json(result)
  })

  app.post('/api/meetings/:id/link', async (req, res) => {
    const meeting = meetings.get(req.params.id)
    if (!meeting) {
      res.status(404).json({ error: 'not-found' })
      return
    }
    let body: Record<string, unknown> = {}
    try {
      body = await readBody(req)
    } catch {
      res.status(400).json({ error: 'bad-json' })
      return
    }
    const secret = typeof body.hostSecret === 'string' ? body.hostSecret : req.header('x-host-secret')
    if (!hostGuard(meeting, secret ?? undefined)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    if (body.linkMode === 'temp' || body.linkMode === 'network') meeting.linkMode = body.linkMode
    for (const host of admitted(meeting).filter((item) => item.isHost)) {
      send(host.ws, { type: 'meeting-updated', meeting: publicMeeting(meeting, true) })
    }
    res.json({
      linkMode: meeting.linkMode,
      enterPath: enterPath(meeting),
      tempToken: meeting.tempToken,
      links: shareLinks(meeting, boundPort, scheme),
    })
  })

  app.post('/api/meetings/:id/end', async (req, res) => {
    const meeting = meetings.get(req.params.id)
    if (!meeting) {
      res.status(404).json({ error: 'not-found' })
      return
    }
    let body: Record<string, unknown> = {}
    try {
      body = await readBody(req)
    } catch {
      body = {}
    }
    const secret = typeof body.hostSecret === 'string' ? body.hostSecret : req.header('x-host-secret')
    if (!hostGuard(meeting, secret ?? undefined)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    endMeeting(meeting)
    res.json({ ok: true })
  })

  if (vite) app.use(vite.middlewares)
  else app.use(express.static(staticDir, { index: false, fallthrough: true }))

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not-found' })
  })

  app.use(async (req, res, next) => {
    if (req.method !== 'GET' || !isSpaPath(req.path)) return next()
    try {
      await sendIndex(res, vite, staticDir, projectRoot, req.originalUrl)
    } catch (error) {
      next(error)
    }
  })

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error)
    if (!res.headersSent) res.status(500).json({ error: 'server' })
  })

  const server = scheme === 'https' ? https.createServer({ key: cert.key, cert: cert.cert }, app) : http.createServer(app)
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1_000_000 })
  wss.on('connection', (socket, request) => {
    const address = request.socket.remoteAddress || 'unknown'
    handleSocket(socket as AliveSocket, address)
  })

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const socket = client as AliveSocket
      if (socket.isAlive === false) {
        socket.terminate()
        continue
      }
      socket.isAlive = false
      socket.ping()
    }
  }, 15000)

  const port = await new Promise<number>((resolve, reject) => {
    const start = options.port ?? 47321
    const tryListen = (candidate: number, left: number) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListen)
        if (error.code === 'EADDRINUSE' && left > 0 && options.port === undefined) tryListen(candidate + 1, left - 1)
        else reject(error)
      }
      const onListen = () => {
        server.off('error', onError)
        const address = server.address()
        resolve(typeof address === 'object' && address ? address.port : candidate)
      }
      server.once('error', onError)
      server.once('listening', onListen)
      server.listen(candidate, options.listenHost ?? '0.0.0.0')
    }
    tryListen(start, options.port === undefined ? 20 : 0)
  })
  boundPort = port

  return {
    port,
    fingerprint: cert.fingerprint,
    close: async () => {
      clearInterval(heartbeat)
      for (const meeting of [...meetings.values()]) endMeeting(meeting)
      meetings.clear()
      tokens.clear()
      tombstones.clear()
      passwordFailures.clear()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
      if (vite) await vite.close()
    },
  }
}

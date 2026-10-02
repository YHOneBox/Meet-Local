import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket, { type RawData } from 'ws'
import { isLoopbackAddress, startMeetServer, type RunningServer } from '../electron/server'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

let server: RunningServer

beforeAll(async () => {
  server = await startMeetServer({ port: 0, listenHost: '127.0.0.1', staticDir: 'dist', publicBase: 'https://meet.example.test' })
})

afterAll(async () => {
  await server.close()
})

function base() {
  return `https://127.0.0.1:${server.port}`
}

async function create(body: Record<string, unknown>) {
  const response = await fetch(`${base()}/api/meetings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.ok).toBe(true)
  return response.json() as Promise<{
    meetingId: string
    tempToken: string
    hostSecret: string
    enterPath: string
    linkMode: string
    links: Array<{ url: string; kind: string }>
    fingerprint: string
    port: number
  }>
}

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://127.0.0.1:${server.port}/ws`, { rejectUnauthorized: false })
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function waitFor(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 5000)
    const onMessage = (raw: RawData) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>
      if (message.type === type) {
        clearTimeout(timer)
        ws.off('message', onMessage)
        resolve(message)
      }
    }
    ws.on('message', onMessage)
  })
}

describe('meeting server', () => {
  it('serves health, session, and a device fingerprint', async () => {
    const health = await fetch(`${base()}/api/health`)
    const body = (await health.json()) as { ok: boolean; fingerprint: string }
    expect(body.ok).toBe(true)
    expect(body.fingerprint).toContain(':')
    const session = await fetch(`${base()}/api/session`)
    const sessionBody = (await session.json()) as { canHost: boolean; interfaces: unknown[] }
    expect(sessionBody.canHost).toBe(true)
    expect(Array.isArray(sessionBody.interfaces)).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('192.168.1.2')).toBe(false)
    expect(health.headers.get('access-control-allow-origin')).toBeNull()
    expect(health.headers.get('x-frame-options')).toBe('DENY')
  })

  it('rejects a remote create and a wrong password, then relays chat', async () => {
    const meeting = await create({ title: 'Design review', password: 'correct horse', linkMode: 'temp', allowStun: false })
    expect(meeting.enterPath).toBe(`/t/${meeting.tempToken}`)
    expect(meeting.port).toBe(server.port)
    for (const link of meeting.links) {
      expect(link.url).toBe(`https://meet.example.test/t/${meeting.tempToken}`)
      expect(link.url).not.toMatch(/\d{1,3}(?:\.\d{1,3}){3}/)
    }
    const hidden = await fetch(`${base()}/api/info?meetingId=${meeting.meetingId}`)
    expect(hidden.status).toBe(404)
    const info = await fetch(`${base()}/api/info?tempToken=${meeting.tempToken}`)
    expect(await info.json()).toMatchObject({ requiresPassword: true, title: 'Design review' })

    const wrong = await connect()
    const wrongWait = waitFor(wrong, 'error')
    wrong.send(JSON.stringify({ type: 'join', name: 'Blair', tempToken: meeting.tempToken, password: 'nope' }))
    expect(await wrongWait).toMatchObject({ code: 'bad-password' })
    wrong.close()

    const host = await connect()
    const hostJoined = waitFor(host, 'joined')
    host.send(JSON.stringify({ type: 'join', name: 'Alex', tempToken: meeting.tempToken, hostSecret: meeting.hostSecret }))
    const joined = await hostJoined
    expect(joined).toMatchObject({ type: 'joined' })

    const guest = await connect()
    const guestJoined = waitFor(guest, 'joined')
    const hostSawGuest = waitFor(host, 'peer-joined')
    guest.send(JSON.stringify({ type: 'join', name: 'Blair', tempToken: meeting.tempToken, password: 'correct horse' }))
    const guestMessage = await guestJoined
    expect((guestMessage.participants as Array<{ name: string }>).some((peer) => peer.name === 'Alex')).toBe(true)
    expect(await hostSawGuest).toMatchObject({ participant: { name: 'Blair' } })

    const hostChat = waitFor(host, 'chat')
    guest.send(JSON.stringify({ type: 'chat', text: 'hello from the guest' }))
    expect(await hostChat).toMatchObject({ message: { text: 'hello from the guest', fromName: 'Blair' } })

    const locked = waitFor(host, 'meeting-updated')
    host.send(JSON.stringify({ type: 'host', action: 'lock', enabled: true }))
    expect(await locked).toMatchObject({ meeting: { locked: true } })
    const blocked = await connect()
    const blockedError = waitFor(blocked, 'error')
    blocked.send(JSON.stringify({ type: 'join', name: 'Casey', tempToken: meeting.tempToken, password: 'correct horse' }))
    expect(await blockedError).toMatchObject({ code: 'locked' })

    host.send(JSON.stringify({ type: 'host', action: 'end' }))
    const ended = await fetch(`${base()}/api/info?tempToken=${meeting.tempToken}`)
    expect(ended.status).toBe(404)
    expect(await ended.json()).toMatchObject({ error: 'ended' })
    host.close()
    guest.close()
    blocked.close()
  })

  it('keeps people in the waiting room until the host admits them', async () => {
    const meeting = await create({ title: 'Standup', linkMode: 'network', waitingRoom: true, password: '' })
    expect(meeting.enterPath).toBe(`/m/${meeting.meetingId}`)
    const tokenInfo = await fetch(`${base()}/api/info?tempToken=${meeting.tempToken}`)
    expect(tokenInfo.status).toBe(404)

    const host = await connect()
    const hostJoined = waitFor(host, 'joined')
    host.send(JSON.stringify({ type: 'join', name: 'Alex', meetingId: meeting.meetingId, hostSecret: meeting.hostSecret }))
    await hostJoined

    const guest = await connect()
    const waiting = waitFor(guest, 'waiting')
    const hostQueue = waitFor(host, 'waiting-list')
    guest.send(JSON.stringify({ type: 'join', name: 'Blair', meetingId: meeting.meetingId }))
    await waiting
    const queue = await hostQueue
    const waitingId = (queue.waiting as Array<{ id: string; name: string }>)[0]
    expect(waitingId.name).toBe('Blair')

    const admitted = waitFor(guest, 'admitted')
    const arrived = waitFor(host, 'peer-joined')
    host.send(JSON.stringify({ type: 'host', action: 'admit', targetId: waitingId.id }))
    expect((await admitted).type).toBe('admitted')
    expect(await arrived).toMatchObject({ participant: { name: 'Blair', waiting: false } })

    const removed = waitFor(guest, 'removed')
    host.send(JSON.stringify({ type: 'host', action: 'remove', targetId: waitingId.id }))
    await removed
    host.close()
    guest.close()
    await fetch(`${base()}/api/meetings/${meeting.meetingId}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostSecret: meeting.hostSecret }),
    })
  })

  it('keeps short passwords and foreign websites out', async () => {
    const weak = await fetch(`${base()}/api/meetings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Short', password: 'tiny', linkMode: 'temp' }),
    })
    expect(weak.status).toBe(400)
    const meeting = await create({ title: 'Quiet', linkMode: 'network' })
    const info = await fetch(`${base()}/api/info?meetingId=${meeting.meetingId}`)
    const body = (await info.json()) as { allowStun: boolean }
    expect(body.allowStun).toBe(false)
    const foreign = new WebSocket(`wss://127.0.0.1:${server.port}/ws`, {
      rejectUnauthorized: false,
      headers: { origin: 'https://evil.example' },
    })
    const closed = await new Promise<number>((resolve, reject) => {
      foreign.once('close', (code) => resolve(code))
      foreign.once('error', reject)
    })
    expect(closed).toBe(1008)
  })

  it('replaces a temporary link without putting the computer address in it', async () => {
    const meeting = await create({ title: 'Rotate', linkMode: 'temp' })
    const host = await connect()
    const joined = waitFor(host, 'joined')
    host.send(JSON.stringify({ type: 'join', name: 'Alex', tempToken: meeting.tempToken, hostSecret: meeting.hostSecret }))
    await joined
    const replaced = waitFor(host, 'temp-token')
    host.send(JSON.stringify({ type: 'host', action: 'regenerate-temp' }))
    const message = (await replaced) as { tempToken: string; publicUrl: string }
    expect(message.tempToken).not.toBe(meeting.tempToken)
    expect(message.publicUrl).toBe(`https://meet.example.test/t/${message.tempToken}`)
    expect(message.publicUrl).not.toMatch(/\d{1,3}(?:\.\d{1,3}){3}/)
    host.close()
  })

  it('opens the host meeting in the browser once and keeps settings on this computer', async () => {
    const meeting = await create({ title: 'Browser host', linkMode: 'network' })
    const url = server.openHostBrowser(meeting.meetingId, meeting.hostSecret)
    expect(url.startsWith(`https://127.0.0.1:${server.port}/h/`)).toBe(true)
    expect(() => server.openHostBrowser(meeting.meetingId, 'not-the-secret')).toThrow(/not open/)
    const ticket = url.split('/h/')[1]
    const first = await fetch(`${base()}/api/tickets/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket }),
    })
    expect(first.status).toBe(200)
    const redeemed = (await first.json()) as { hostSecret: string; enterPath: string; meetingId: string }
    expect(redeemed.hostSecret).toBe(meeting.hostSecret)
    expect(redeemed.meetingId).toBe(meeting.meetingId)
    expect(redeemed.enterPath).toBe(meeting.enterPath)
    const second = await fetch(`${base()}/api/tickets/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket }),
    })
    expect(second.status).toBe(404)

    const saved = await fetch(`${base()}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fontSize: 'large', style: 'contrast', layout: 'speaker', waitingRoom: true, micOn: false }),
    })
    expect(saved.status).toBe(200)
    const read = await fetch(`${base()}/api/settings`)
    const prefs = (await read.json()) as { fontSize: string; style: string; layout: string; micOn: boolean; waitingRoom: boolean }
    expect(prefs).toMatchObject({ fontSize: 'large', style: 'contrast', layout: 'speaker', micOn: false, waitingRoom: true })
    const invalid = await fetch(`${base()}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fontSize: 'huge', style: 'neon' }),
    })
    const fallback = (await invalid.json()) as { fontSize: string; style: string }
    expect(fallback.fontSize).toBe('small')
    expect(fallback.style).toBe('night')
  })
})

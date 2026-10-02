import type { LinkMode, ShareLink } from '../shared/protocol'

export type InterfaceInfo = {
  name: string
  label: string
  address: string
  kind: 'vpn' | 'lan' | 'other'
}

export type SessionInfo = {
  canHost: boolean
  interfaces: InterfaceInfo[]
  fingerprint: string
}

export type MeetingInfo = {
  meetingId?: string
  title: string
  linkMode: LinkMode
  locked: boolean
  waitingRoom: boolean
  allowStun: boolean
  requiresPassword: boolean
  tempToken: string | null
  isHost: boolean
  fingerprint: string
}

export type CreateResult = {
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

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    return body.error || `Request failed (${response.status})`
  } catch {
    return `Request failed (${response.status})`
  }
}

export async function getSession(): Promise<SessionInfo> {
  const response = await fetch('/api/session')
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<SessionInfo>
}

export async function getMeetingInfo(base: string, target: { meetingId?: string; tempToken?: string }, hostSecret?: string): Promise<MeetingInfo> {
  const url = new URL('/api/info', base)
  if (target.meetingId) url.searchParams.set('meetingId', target.meetingId)
  if (target.tempToken) url.searchParams.set('tempToken', target.tempToken)
  const response = await fetch(url, {
    headers: hostSecret ? { 'X-Host-Secret': hostSecret } : undefined,
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<MeetingInfo>
}

export async function createMeeting(input: {
  title: string
  password: string
  waitingRoom: boolean
  linkMode: LinkMode
  allowStun: boolean
  preferredAddress: string
}): Promise<CreateResult> {
  const response = await fetch('/api/meetings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<CreateResult>
}

export async function updateLinkMode(meetingId: string, hostSecret: string, linkMode: LinkMode): Promise<{ linkMode: LinkMode; enterPath: string; tempToken: string; links: ShareLink[] }> {
  const response = await fetch(`/api/meetings/${meetingId}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Host-Secret': hostSecret },
    body: JSON.stringify({ hostSecret, linkMode }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<{ linkMode: LinkMode; enterPath: string; tempToken: string; links: ShareLink[] }>
}

export async function endMeetingHttp(meetingId: string, hostSecret: string): Promise<void> {
  const response = await fetch(`/api/meetings/${meetingId}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Host-Secret': hostSecret },
    body: JSON.stringify({ hostSecret }),
  })
  if (!response.ok && response.status !== 404) throw new Error(await readError(response))
}

export function errorCopy(code: string): string {
  const copy: Record<string, string> = {
    'bad-password': 'That password is not right.',
    'not-found': 'This meeting link does not exist.',
    ended: 'This meeting has ended.',
    locked: 'The host has locked this meeting.',
    'rate-limited': 'Too many attempts. Wait a moment and try again.',
    full: 'This meeting is full (8 people).',
    name: 'Enter your name to join.',
    'host-only': 'Only this computer can host a meeting.',
    forbidden: 'That action is reserved for the host.',
  }
  return copy[code] || 'Something went wrong. Try again.'
}

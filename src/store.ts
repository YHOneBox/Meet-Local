import type { LinkMode, ShareLink } from '../shared/protocol'
import type { ParsedLink } from '../shared/urls'

export type HostRecord = {
  meetingId: string
  tempToken: string
  hostSecret: string
  linkMode: LinkMode
  enterPath: string
  title: string
  password: string
  shareUrl: string
  fingerprint: string
}

export type JoinTarget = ParsedLink & { title?: string }

export type Handoff = {
  name: string
  stream: MediaStream
  micOn: boolean
  camOn: boolean
  speakerId: string
  target: JoinTarget
  password?: string
  hostSecret?: string
  title: string
}

const HOST_KEY = 'meetlocal.host'
const JOIN_KEY = 'meetlocal.join'
const NAME_KEY = 'meetlocal.name'

let handoff: Handoff | null = null

export function saveHost(record: HostRecord) {
  sessionStorage.setItem(HOST_KEY, JSON.stringify(record))
}

export function readHost(): HostRecord | null {
  const raw = sessionStorage.getItem(HOST_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as HostRecord
  } catch {
    return null
  }
}

export function clearHost() {
  sessionStorage.removeItem(HOST_KEY)
}

export function saveJoinTarget(target: JoinTarget) {
  sessionStorage.setItem(JOIN_KEY, JSON.stringify(target))
}

export function readJoinTarget(): JoinTarget | null {
  const raw = sessionStorage.getItem(JOIN_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as JoinTarget
  } catch {
    return null
  }
}

export function setHandoff(next: Handoff | null) {
  handoff = next
}

export function takeHandoff(): Handoff | null {
  return handoff
}

export function savedName(): string {
  return localStorage.getItem(NAME_KEY) || ''
}

export function rememberName(name: string) {
  localStorage.setItem(NAME_KEY, name)
}

export function hostMatches(target: JoinTarget, host: HostRecord | null): host is HostRecord {
  if (!host) return false
  if (target.tempToken && host.tempToken === target.tempToken) return true
  if (target.meetingId && host.meetingId === target.meetingId) return true
  return false
}

export type CreatedView = {
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
  password: string
}

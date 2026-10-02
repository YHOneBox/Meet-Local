export const MAX_PEERS = 8

export const REACTIONS = ['👍', '👏', '😂', '🎉', '❤️', '😮'] as const
export type ReactionEmoji = (typeof REACTIONS)[number]

export type LinkMode = 'network' | 'temp'

export type DescriptionInit = {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback'
  sdp?: string
}

export type IceCandidateInit = {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export type SignalData =
  | { description: DescriptionInit }
  | { candidate: IceCandidateInit | null }

export type PeerInfo = {
  id: string
  name: string
  mic: boolean
  cam: boolean
  sharing: boolean
  raised: boolean
  isHost: boolean
  waiting: boolean
}

export type ChatMessage = {
  id: string
  fromId: string
  fromName: string
  text: string
  at: number
}

export type HostAction =
  | 'mute'
  | 'remove'
  | 'admit'
  | 'deny'
  | 'lock'
  | 'waiting-room'
  | 'end'
  | 'regenerate-temp'

export type ClientMessage =
  | {
      type: 'join'
      name: string
      password?: string
      meetingId?: string
      tempToken?: string
      hostSecret?: string
    }
  | { type: 'signal'; to: string; data: SignalData }
  | { type: 'chat'; text: string }
  | { type: 'state'; mic: boolean; cam: boolean; sharing: boolean; raised: boolean }
  | { type: 'reaction'; emoji: string }
  | { type: 'host'; action: HostAction; targetId?: string; enabled?: boolean }

export type MeetingPublic = {
  title: string
  linkMode: LinkMode
  locked: boolean
  waitingRoom: boolean
  allowStun: boolean
  requiresPassword: boolean
}

export type ServerMessage =
  | { type: 'waiting' }
  | { type: 'denied' }
  | { type: 'removed' }
  | { type: 'meeting-ended' }
  | { type: 'force-mute' }
  | { type: 'error'; code: string; message: string }
  | {
      type: 'joined'
      self: PeerInfo
      meeting: MeetingPublic & { meetingId: string; tempToken: string | null }
      participants: PeerInfo[]
      waiting: PeerInfo[]
      chat: ChatMessage[]
    }
  | {
      type: 'admitted'
      self: PeerInfo
      meeting: MeetingPublic & { meetingId: string; tempToken: string | null }
      participants: PeerInfo[]
      waiting: PeerInfo[]
      chat: ChatMessage[]
    }
  | { type: 'peer-joined'; participant: PeerInfo }
  | { type: 'peer-left'; id: string }
  | { type: 'peer-state'; participant: PeerInfo }
  | { type: 'waiting-list'; waiting: PeerInfo[] }
  | { type: 'signal'; from: string; data: SignalData }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'reaction'; fromId: string; fromName: string; emoji: ReactionEmoji }
  | { type: 'meeting-updated'; meeting: MeetingPublic & { meetingId: string; tempToken: string | null } }
  | { type: 'temp-token'; tempToken: string }

export type InterfaceKind = 'vpn' | 'lan' | 'other'

export type ShareLink = {
  name: string
  label: string
  address: string
  kind: InterfaceKind
  url: string
}

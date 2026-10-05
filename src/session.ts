import type { ChatMessage, PeerInfo, ServerMessage, SignalData } from '../shared/protocol'
import { websocketUrl } from '../shared/urls'
import { readHost, saveHost, type Handoff } from './store'

export type PeerView = {
  info: PeerInfo
  camera: MediaStream
  screen: MediaStream
  audio: MediaStream
  connection: RTCPeerConnectionState
  mediaVersion: number
}

type Link = {
  pc: RTCPeerConnection
  audio: RTCRtpTransceiver | null
  camera: RTCRtpTransceiver | null
  screen: RTCRtpTransceiver | null
  screenAudio: RTCRtpTransceiver | null
  polite: boolean
  canOffer: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  settingRemoteAnswer: boolean
  pending: RTCIceCandidateInit[]
  cameraStream: MediaStream
  screenStream: MediaStream
  audioStream: MediaStream
  connection: RTCPeerConnectionState
  mediaVersion: number
}

export type SessionStatus = 'connecting' | 'waiting' | 'joined' | 'denied' | 'removed' | 'ended' | 'error'

function constraintsFor(kind: 'audio' | 'video', deviceId: string, saveData: boolean, processing: boolean): MediaTrackConstraints | boolean {
  if (kind === 'audio') {
    return {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: processing,
      noiseSuppression: processing,
      autoGainControl: processing,
    }
  }
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    width: saveData ? { ideal: 640 } : { ideal: 1280 },
    height: saveData ? { ideal: 360 } : { ideal: 720 },
    frameRate: { ideal: saveData ? 15 : 24 },
  }
}

export async function openDevices(options: {
  micId: string
  camId: string
  wantMic: boolean
  wantCam: boolean
  saveData: boolean
  processing: boolean
}): Promise<MediaStream> {
  if (!options.wantMic && !options.wantCam) return new MediaStream()
  return navigator.mediaDevices.getUserMedia({
    audio: options.wantMic ? constraintsFor('audio', options.micId, options.saveData, options.processing) : false,
    video: options.wantCam ? constraintsFor('video', options.camId, options.saveData, options.processing) : false,
  })
}

export class RoomSession {
  status: SessionStatus = 'connecting'
  error = ''
  self: PeerInfo | null = null
  meeting: Extract<ServerMessage, { type: 'joined' }>['meeting'] | null = null
  peers = new Map<string, PeerView>()
  waiting: PeerInfo[] = []
  chat: ChatMessage[] = []
  micOn: boolean
  camOn: boolean
  raised = false
  localStream: MediaStream
  screenStream: MediaStream | null = null
  onChange: () => void = () => {}
  onReaction: (reaction: { id: string; fromName: string; emoji: string }) => void = () => {}
  onToast: (text: string) => void = () => {}

  private ws: WebSocket | null = null
  private selfId = ''
  private links = new Map<string, Link>()
  private queue: ServerMessage[] = []
  private pumping = false
  private closed = false
  private retries = 0
  private screenTrack: MediaStreamTrack | null = null
  private screenAudioTrack: MediaStreamTrack | null = null
  private allowStun = true
  private password: string
  private hostSecret?: string

  constructor(private handoff: Handoff) {
    this.localStream = handoff.stream
    this.micOn = handoff.micOn && this.localStream.getAudioTracks().length > 0
    this.camOn = handoff.camOn && this.localStream.getVideoTracks().length > 0
    this.password = handoff.password || ''
    this.hostSecret = handoff.hostSecret
    for (const track of this.localStream.getAudioTracks()) track.enabled = this.micOn
    for (const track of this.localStream.getVideoTracks()) track.enabled = this.camOn
  }

  connect() {
    this.openSocket()
  }

  close() {
    this.closed = true
    this.ws?.close()
    for (const link of this.links.values()) link.pc.close()
    this.links.clear()
    this.localStream.getTracks().forEach((track) => track.stop())
    this.screenStream?.getTracks().forEach((track) => track.stop())
  }

  async setMic(on: boolean) {
    this.micOn = on
    const track = this.localStream.getAudioTracks()[0]
    if (track) track.enabled = on
    for (const link of this.links.values()) {
      if (link.audio) await link.audio.sender.replaceTrack(on ? track ?? null : null)
    }
    this.pushState()
    this.emit()
  }

  async setCam(on: boolean, deviceId = '', saveData = false) {
    this.camOn = on
    if (on) {
      let track = this.localStream.getVideoTracks()[0]
      if (!track || track.readyState === 'ended') {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: constraintsFor('video', deviceId, saveData, true),
        })
        track = stream.getVideoTracks()[0]
        this.localStream.addTrack(track)
      } else {
        track.enabled = true
      }
      for (const link of this.links.values()) {
        if (link.camera) await link.camera.sender.replaceTrack(track)
      }
    } else {
      const track = this.localStream.getVideoTracks()[0]
      if (track) {
        track.stop()
        this.localStream.removeTrack(track)
      }
      for (const link of this.links.values()) {
        if (link.camera) await link.camera.sender.replaceTrack(null)
      }
    }
    this.pushState()
    this.emit()
  }

  async replaceMic(track: MediaStreamTrack) {
    const previous = this.localStream.getAudioTracks()[0]
    if (previous) {
      previous.stop()
      this.localStream.removeTrack(previous)
    }
    track.enabled = this.micOn
    this.localStream.addTrack(track)
    for (const link of this.links.values()) {
      if (link.audio) await link.audio.sender.replaceTrack(this.micOn ? track : null)
    }
    this.emit()
  }

  async replaceCamera(track: MediaStreamTrack) {
    const previous = this.localStream.getVideoTracks()[0]
    if (previous) {
      previous.stop()
      this.localStream.removeTrack(previous)
    }
    track.enabled = this.camOn
    this.localStream.addTrack(track)
    if (this.camOn) {
      for (const link of this.links.values()) {
        if (link.camera) await link.camera.sender.replaceTrack(track)
      }
    }
    this.emit()
  }

  async startScreen(stream: MediaStream) {
    this.stopScreenTracks()
    const track = stream.getVideoTracks()[0]
    if (!track) return
    const audioTrack = stream.getAudioTracks()[0] ?? null
    track.contentHint = 'detail'
    track.onended = () => {
      void this.stopScreen()
    }
    this.screenTrack = track
    this.screenAudioTrack = audioTrack
    this.screenStream = stream
    const pending: Promise<void>[] = []
    for (const link of this.links.values()) {
      link.canOffer = true
      if (!link.screen) link.screen = link.pc.addTransceiver(track, { direction: 'sendrecv' })
      else pending.push(link.screen.sender.replaceTrack(track).then(() => undefined))
      if (audioTrack) {
        if (!link.screenAudio) link.screenAudio = link.pc.addTransceiver(audioTrack, { direction: 'sendrecv' })
        else pending.push(link.screenAudio.sender.replaceTrack(audioTrack).then(() => undefined))
      } else if (link.screenAudio) {
        pending.push(link.screenAudio.sender.replaceTrack(null).then(() => undefined))
      }
    }
    await Promise.all(pending)
    this.pushState()
    this.emit()
  }

  async stopScreen() {
    this.stopScreenTracks()
    const pending: Promise<void>[] = []
    for (const link of this.links.values()) {
      if (link.screen) pending.push(link.screen.sender.replaceTrack(null).then(() => undefined))
      if (link.screenAudio) pending.push(link.screenAudio.sender.replaceTrack(null).then(() => undefined))
    }
    await Promise.all(pending)
    this.pushState()
    this.emit()
  }

  setRaised(on: boolean) {
    this.raised = on
    this.pushState()
    this.emit()
  }

  sendChat(text: string) {
    const clean = text.trim()
    if (!clean) return
    this.send({ type: 'chat', text: clean })
  }

  react(emoji: string) {
    this.send({ type: 'reaction', emoji })
  }

  host(action: 'mute' | 'remove' | 'admit' | 'deny' | 'lock' | 'waiting-room' | 'end' | 'regenerate-temp', targetId?: string, enabled?: boolean) {
    this.send({ type: 'host', action, targetId, enabled })
  }

  private rememberShareUrl(publicUrl: string | null, tempToken: string | null, linkMode: 'network' | 'temp') {
    if (!this.self?.isHost || !publicUrl) return
    const host = readHost()
    if (!host) return
    saveHost({
      ...host,
      linkMode,
      shareUrl: publicUrl,
      tempToken: tempToken || host.tempToken,
      enterPath: tempToken ? `/t/${tempToken}` : host.enterPath,
    })
  }

  private stopScreenTracks() {
    this.screenTrack?.stop()
    this.screenAudioTrack?.stop()
    this.screenStream?.getTracks().forEach((track) => track.stop())
    this.screenTrack = null
    this.screenAudioTrack = null
    this.screenStream = null
  }

  private openSocket() {
    const ws = new WebSocket(websocketUrl(this.handoff.target.httpBase))
    this.ws = ws
    ws.onopen = () => {
      this.retries = 0
      this.send({
        type: 'join',
        name: this.handoff.name,
        password: this.password || undefined,
        meetingId: this.handoff.target.meetingId,
        tempToken: this.handoff.target.tempToken,
        hostSecret: this.hostSecret,
      })
    }
    ws.onmessage = (event) => {
      try {
        this.enqueue(JSON.parse(String(event.data)) as ServerMessage)
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onclose = () => {
      if (this.closed || this.status === 'ended' || this.status === 'denied' || this.status === 'removed' || this.status === 'error') return
      if (this.status === 'waiting') return
      if (this.retries >= 3) {
        this.status = 'error'
        this.error = 'The connection to the meeting dropped.'
        this.emit()
        return
      }
      this.retries += 1
      this.onToast('Reconnecting…')
      this.dropLinks()
      window.setTimeout(() => {
        if (!this.closed) this.openSocket()
      }, 800 * this.retries)
    }
  }

  private enqueue(message: ServerMessage) {
    this.queue.push(message)
    void this.pump()
  }

  private async pump() {
    if (this.pumping) return
    this.pumping = true
    while (this.queue.length) {
      const message = this.queue.shift()
      if (message) await this.handle(message)
    }
    this.pumping = false
  }

  private async handle(message: ServerMessage) {
    if (message.type === 'waiting') {
      this.status = 'waiting'
      this.emit()
      return
    }
    if (message.type === 'denied') {
      this.status = 'denied'
      this.closed = true
      this.emit()
      return
    }
    if (message.type === 'removed') {
      this.status = 'removed'
      this.closed = true
      this.onToast('The host removed you from the meeting.')
      this.emit()
      return
    }
    if (message.type === 'meeting-ended') {
      this.status = 'ended'
      this.closed = true
      this.emit()
      return
    }
    if (message.type === 'error') {
      this.status = 'error'
      this.error = message.message
      this.closed = true
      this.emit()
      return
    }
    if (message.type === 'force-mute') {
      this.micOn = false
      const track = this.localStream.getAudioTracks()[0]
      if (track) track.enabled = false
      this.onToast('The host muted you.')
      this.pushState()
      this.emit()
      return
    }
    if (message.type === 'joined' || message.type === 'admitted') {
      this.status = 'joined'
      this.self = message.self
      this.selfId = message.self.id
      this.meeting = message.meeting
      this.allowStun = message.meeting.allowStun
      this.chat = message.chat
      this.waiting = message.waiting
      for (const participant of message.participants) {
        if (!this.peers.has(participant.id)) this.peers.set(participant.id, this.blank(participant))
        this.attach(participant.id)
      }
      this.pushState()
      if (message.type === 'admitted') this.onToast('You are in the meeting.')
      this.emit()
      return
    }
    if (message.type === 'peer-joined') {
      this.peers.set(message.participant.id, this.blank(message.participant))
      if (this.selfId) this.attach(message.participant.id)
      this.onToast(`${message.participant.name} joined`)
      this.emit()
      return
    }
    if (message.type === 'peer-left') {
      const existing = this.peers.get(message.id)
      this.links.get(message.id)?.pc.close()
      this.links.delete(message.id)
      this.peers.delete(message.id)
      if (existing) this.onToast(`${existing.info.name} left`)
      this.emit()
      return
    }
    if (message.type === 'peer-state') {
      const view = this.peers.get(message.participant.id)
      if (view) {
        view.info = message.participant
        view.mediaVersion += 1
      }
      this.emit()
      return
    }
    if (message.type === 'waiting-list') {
      this.waiting = message.waiting
      this.emit()
      return
    }
    if (message.type === 'chat') {
      this.chat = [...this.chat, message.message].slice(-200)
      this.emit()
      return
    }
    if (message.type === 'reaction') {
      this.onReaction({ id: `${message.fromId}-${Date.now()}`, fromName: message.fromName, emoji: message.emoji })
      return
    }
    if (message.type === 'meeting-updated') {
      this.meeting = message.meeting
      this.rememberShareUrl(message.meeting.publicUrl, message.meeting.tempToken, message.meeting.linkMode)
      this.emit()
      return
    }
    if (message.type === 'temp-token' && this.meeting) {
      this.meeting = { ...this.meeting, tempToken: message.tempToken, publicUrl: message.publicUrl }
      this.rememberShareUrl(message.publicUrl, message.tempToken, 'temp')
      this.onToast('The temporary link was replaced.')
      this.emit()
      return
    }
    if (message.type === 'signal') await this.onSignal(message.from, message.data)
  }

  private blank(info: PeerInfo): PeerView {
    return {
      info,
      camera: new MediaStream(),
      screen: new MediaStream(),
      audio: new MediaStream(),
      connection: 'new',
      mediaVersion: 0,
    }
  }

  private attach(peerId: string) {
    if (!this.selfId || peerId === this.selfId || this.links.has(peerId)) return
    const pc = new RTCPeerConnection({
      iceServers: this.allowStun ? [{ urls: 'stun:stun.l.google.com:19302' }] : [],
      bundlePolicy: 'max-bundle',
    })
    const initialOfferer = this.selfId > peerId
    const link: Link = {
      pc,
      audio: null,
      camera: null,
      screen: null,
      screenAudio: null,
      polite: this.selfId < peerId,
      canOffer: initialOfferer,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      pending: [],
      cameraStream: new MediaStream(),
      screenStream: new MediaStream(),
      audioStream: new MediaStream(),
      connection: 'new',
      mediaVersion: 0,
    }
    this.links.set(peerId, link)
    const view = this.peers.get(peerId)
    if (view) {
      view.camera = link.cameraStream
      view.screen = link.screenStream
      view.audio = link.audioStream
    }

    const negotiate = async () => {
      if (!link.canOffer || pc.signalingState !== 'stable' || link.makingOffer) return
      try {
        link.makingOffer = true
        await pc.setLocalDescription()
        const description = pc.localDescription
        if (!description) return
        this.send({ type: 'signal', to: peerId, data: { description: { type: description.type, sdp: description.sdp } } })
      } catch (error) {
        console.error(error)
      } finally {
        link.makingOffer = false
      }
    }

    pc.onnegotiationneeded = () => {
      void negotiate()
    }
    pc.onicecandidate = (event) => {
      this.send({
        type: 'signal',
        to: peerId,
        data: { candidate: event.candidate ? event.candidate.toJSON() : null },
      })
    }
    pc.ontrack = (event) => {
      this.placeRemoteTrack(link, event)
      link.mediaVersion += 1
      const current = this.peers.get(peerId)
      if (current) {
        current.mediaVersion = link.mediaVersion
        current.camera = link.cameraStream
        current.screen = link.screenStream
        current.audio = link.audioStream
      }
      event.track.onended = () => this.emit()
      event.track.onmute = () => this.emit()
      event.track.onunmute = () => this.emit()
      this.emit()
    }
    pc.onconnectionstatechange = () => {
      link.connection = pc.connectionState
      const current = this.peers.get(peerId)
      if (current) current.connection = pc.connectionState
      this.emit()
    }
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        link.canOffer = true
        void pc.restartIce()
      }
    }

    if (initialOfferer) {
      link.canOffer = false
      link.audio = pc.addTransceiver('audio', { direction: 'sendrecv' })
      link.camera = pc.addTransceiver('video', { direction: 'sendrecv' })
      link.screen = pc.addTransceiver(this.screenTrack ?? 'video', { direction: 'sendrecv' })
      link.screenAudio = pc.addTransceiver(this.screenAudioTrack ?? 'audio', { direction: 'sendrecv' })
      void this.sendLocalTracks(link).then(() => {
        link.canOffer = true
        void negotiate()
      })
    }
  }

  private placeRemoteTrack(link: Link, event: RTCTrackEvent) {
    const track = event.track
    if (track.kind === 'audio') {
      const audios = link.pc.getTransceivers().filter((item) => item.receiver.track?.kind === 'audio')
      const index = audios.findIndex((item) => item === event.transceiver)
      if (index > 0) {
        link.screenAudio = event.transceiver
        this.putTrack(link.screenStream, track)
        return
      }
      this.putTrack(link.audioStream, track)
      return
    }
    const videos = link.pc.getTransceivers().filter((item) => item.receiver.track?.kind === 'video')
    const index = videos.findIndex((item) => item === event.transceiver)
    if (index > 0) {
      link.screen = event.transceiver
      this.putTrack(link.screenStream, track)
      return
    }
    this.putTrack(link.cameraStream, track)
  }

  private bindMedia(link: Link) {
    const transceivers = link.pc.getTransceivers()
    const videos = transceivers.filter((item) => item.receiver.track?.kind === 'video' || item.sender.track?.kind === 'video')
    const audios = transceivers.filter((item) => item.receiver.track?.kind === 'audio' || item.sender.track?.kind === 'audio')
    if (!link.audio && audios[0]) link.audio = audios[0]
    if (!link.screenAudio && audios[1]) link.screenAudio = audios[1]
    if (!link.camera && videos[0]) link.camera = videos[0]
    if (!link.screen && videos[1]) link.screen = videos[1]
  }

  private async sendLocalTracks(link: Link) {
    this.bindMedia(link)
    const mic = this.micOn ? this.localStream.getAudioTracks()[0] ?? null : null
    const cam = this.camOn ? this.localStream.getVideoTracks()[0] ?? null : null
    if (link.audio) {
      link.audio.direction = 'sendrecv'
      await link.audio.sender.replaceTrack(mic)
    }
    if (link.camera) {
      link.camera.direction = 'sendrecv'
      await link.camera.sender.replaceTrack(cam)
    }
    if (link.screen) {
      link.screen.direction = 'sendrecv'
      if (link.screen.sender.track !== this.screenTrack) await link.screen.sender.replaceTrack(this.screenTrack)
    }
    if (link.screenAudio) {
      link.screenAudio.direction = 'sendrecv'
      if (link.screenAudio.sender.track !== this.screenAudioTrack) await link.screenAudio.sender.replaceTrack(this.screenAudioTrack)
    }
  }

  private putTrack(stream: MediaStream, track: MediaStreamTrack) {
    for (const existing of stream.getTracks()) {
      if (existing.kind === track.kind && existing.id !== track.id) stream.removeTrack(existing)
    }
    if (!stream.getTrackById(track.id)) stream.addTrack(track)
  }

  private async onSignal(from: string, data: SignalData) {
    if (!this.links.has(from) && this.selfId) this.attach(from)
    const link = this.links.get(from)
    if (!link || link.pc.signalingState === 'closed') return
    const pc = link.pc
    if ('description' in data && data.description) {
      const description = data.description
      if (description.type === 'rollback') return
      if (description.type === 'offer' && pc.signalingState !== 'stable') {
        if (!link.polite) return
        await pc.setLocalDescription({ type: 'rollback' })
      }
      link.settingRemoteAnswer = description.type === 'answer'
      try {
        await pc.setRemoteDescription(description)
      } catch (error) {
        console.error(error)
        return
      }
      link.settingRemoteAnswer = false
      const queued = link.pending
      link.pending = []
      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(candidate)
        } catch (error) {
          if (!link.ignoreOffer) console.error(error)
        }
      }
      if (description.type === 'offer') {
        await this.sendLocalTracks(link)
        await pc.setLocalDescription()
        const answer = pc.localDescription
        if (answer) this.send({ type: 'signal', to: from, data: { description: { type: answer.type, sdp: answer.sdp } } })
      }
      return
    }
    if ('candidate' in data && data.candidate) {
      if (!pc.remoteDescription) link.pending.push(data.candidate)
      else {
        try {
          await pc.addIceCandidate(data.candidate)
        } catch (error) {
          if (!link.ignoreOffer) console.error(error)
        }
      }
    }
  }

  private dropLinks() {
    for (const link of this.links.values()) link.pc.close()
    this.links.clear()
    this.peers.clear()
  }

  private pushState() {
    this.send({
      type: 'state',
      mic: this.micOn,
      cam: this.camOn,
      sharing: Boolean(this.screenTrack),
      raised: this.raised,
    })
  }

  private send(message: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  private emit() {
    this.onChange()
  }
}

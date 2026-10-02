import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { REACTIONS } from '../../shared/protocol'
import type { PeerInfo } from '../../shared/protocol'
import QRCode from 'qrcode'
import { loadPrefs, savePrefs, type Prefs } from '../prefs'
import { MeetingRecorder, saveRecording } from '../recording'
import { RoomSession, openDevices, type PeerView } from '../session'
import { captureScreen } from '../meeting/ScreenPicker'
import { ScreenPicker } from '../meeting/ScreenPicker'
import { clearHost, readHost, readJoinTarget, takeHandoff } from '../store'
import { Avatar, Icon, MediaView, useSpeaking } from '../ui'

type Dialog = 'none' | 'leave' | 'settings' | 'shortcuts' | 'details' | 'share'
type Panel = 'none' | 'chat' | 'people' | 'more'

export function MeetingPage() {
  const navigate = useNavigate()
  const handoff = useMemo(() => takeHandoff(), [])
  const sessionRef = useRef<RoomSession | null>(null)
  const [version, setVersion] = useState(0)
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])
  const [reactions, setReactions] = useState<{ id: string; fromName: string; emoji: string }[]>([])
  const [panel, setPanel] = useState<Panel>('none')
  const [dialog, setDialog] = useState<Dialog>('none')
  const [layout, setLayout] = useState<'gallery' | 'speaker'>('gallery')
  const [pinned, setPinned] = useState('')
  const [unread, setUnread] = useState(0)
  const [draft, setDraft] = useState('')
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs())
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [recording, setRecording] = useState(false)
  const [recordFrom, setRecordFrom] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [qr, setQr] = useState('')
  const [idle, setIdle] = useState(false)
  const started = useRef(Date.now())
  const recorderRef = useRef<MeetingRecorder | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const seenChat = useRef(0)

  useEffect(() => {
    if (!handoff) {
      const target = readJoinTarget()
      if (target?.tempToken && target.httpBase === window.location.origin) navigate(`/t/${target.tempToken}`, { replace: true })
      else if (target?.meetingId && target.httpBase === window.location.origin) navigate(`/m/${target.meetingId}`, { replace: true })
      else if (target?.tempToken || target?.meetingId) {
        const link = target.tempToken ? `${target.httpBase}/t/${target.tempToken}` : `${target.httpBase}/m/${target.meetingId}`
        navigate(`/join?u=${encodeURIComponent(link)}`, { replace: true })
      } else navigate('/', { replace: true })
      return
    }
    const session = new RoomSession(handoff)
    sessionRef.current = session
    session.onChange = () => setVersion((value) => value + 1)
    session.onToast = (text) => pushToast(text)
    session.onReaction = (reaction) => {
      setReactions((current) => [...current, reaction].slice(-12))
      window.setTimeout(() => {
        setReactions((current) => current.filter((item) => item.id !== reaction.id))
      }, 2400)
    }
    session.connect()
    setVersion((value) => value + 1)
    document.title = `${handoff.title} · MeetLocal`
    return () => {
      if (!recorderRef.current) session.close()
    }
    // The session owns the lifetime of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff])

  const session = sessionRef.current
  void version

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (panel || dialog !== 'none') {
      setIdle(false)
      return
    }
    let timer = window.setTimeout(() => setIdle(true), 4000)
    const move = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), 4000)
    }
    window.addEventListener('mousemove', move)
    return () => {
      window.removeEventListener('mousemove', move)
      window.clearTimeout(timer)
    }
  }, [panel, dialog])

  useEffect(() => {
    if (!session) return
    if (session.chat.length > seenChat.current && panel !== 'chat') {
      const fresh = session.chat.slice(seenChat.current).filter((message) => message.fromId !== session.self?.id)
      if (fresh.length) setUnread((count) => count + fresh.length)
    }
    seenChat.current = session.chat.length
    if (panel === 'chat' && chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [session, session?.chat.length, panel])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        if (event.key === 'Escape') (target as HTMLElement).blur()
        return
      }
      const meta = event.ctrlKey || event.metaKey
      if (meta && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        void sessionRef.current?.setMic(!sessionRef.current.micOn)
      } else if (meta && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        void toggleCam()
      } else if (meta && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void beginShare()
      } else if (meta && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        setPanel((current) => (current === 'chat' ? 'none' : 'chat'))
      } else if (meta && event.shiftKey && event.key.toLowerCase() === 'h') {
        event.preventDefault()
        sessionRef.current?.setRaised(!sessionRef.current.raised)
      } else if (meta && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        void toggleFullscreen()
      } else if (event.key === 'Escape') {
        setPanel('none')
        setDialog('none')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function pushToast(text: string) {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, text }].slice(-4))
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3200)
  }

  async function toggleCam() {
    const current = sessionRef.current
    if (!current) return
    await current.setCam(!current.camOn, prefs.camId, prefs.saveData)
  }

  async function beginShare() {
    const current = sessionRef.current
    if (!current) return
    if (current.screenStream) {
      await current.stopScreen()
      return
    }
    if (window.meetlocal?.isDesktop) {
      setDialog('share')
      return
    }
    try {
      const stream = await captureScreen(undefined, false)
      await current.startScreen(stream)
    } catch {
      pushToast('Screen sharing was cancelled.')
    }
  }

  async function toggleRecord() {
    const current = sessionRef.current
    if (!current) return
    if (!recording) {
      const recorder = new MeetingRecorder()
      const videos = [...document.querySelectorAll<HTMLVideoElement>('[data-record-video]')]
      const streams = [current.localStream]
      if (current.screenStream) streams.push(current.screenStream)
      for (const peer of current.peers.values()) {
        streams.push(peer.audio)
        if (peer.screen.getAudioTracks().length > 0) streams.push(peer.screen)
      }
      recorder.setInputs(
        videos.map((video) => ({ video, label: video.dataset.recordLabel || 'Guest' })),
        streams,
      )
      recorder.start()
      recorderRef.current = recorder
      setRecording(true)
      setRecordFrom(Date.now())
      setPanel('none')
      return
    }
    const blob = await recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
    if (!blob) return
    const filename = `MeetLocal-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`
    const saved = await saveRecording(blob, filename)
    if (!saved.canceled) pushToast(saved.filePath ? `Saved ${saved.filePath}` : 'Recording downloaded.')
  }

  function leave(endForAll = false) {
    const current = sessionRef.current
    if (endForAll) current?.host('end')
    else current?.close()
    if (current?.self?.isHost && endForAll) clearHost()
    navigate('/')
  }

  async function changeDevice(kind: 'mic' | 'cam', deviceId: string) {
    const next = { ...prefs, [kind === 'mic' ? 'micId' : 'camId']: deviceId }
    setPrefs(next)
    savePrefs(next)
    const current = sessionRef.current
    if (!current) return
    const stream = await openDevices({
      micId: kind === 'mic' ? deviceId : '',
      camId: kind === 'cam' ? deviceId : '',
      wantMic: kind === 'mic',
      wantCam: kind === 'cam',
      saveData: next.saveData,
      processing: next.processing,
    })
    if (kind === 'mic') {
      const track = stream.getAudioTracks()[0]
      if (track) await current.replaceMic(track)
    } else {
      const track = stream.getVideoTracks()[0]
      if (track) await current.replaceCamera(track)
    }
  }

  if (!session || !handoff) {
    return (
      <div className="room center-note">
        <p>Connecting…</p>
      </div>
    )
  }

  if (session.status === 'waiting') {
    return (
      <div className="room center-note">
        <div className="panel dark-card">
          <p className="kicker">Waiting room</p>
          <h2 data-testid="waiting-room">The host will let you in</h2>
          <p>Stay on this screen. You will join {session.meeting?.title || handoff.title} when the host admits you.</p>
          <button className="btn" type="button" onClick={() => leave(false)}>
            Leave
          </button>
        </div>
      </div>
    )
  }

  if (session.status === 'error' || session.status === 'denied' || session.status === 'removed' || session.status === 'ended') {
    const copy =
      session.status === 'ended'
        ? 'This meeting has ended.'
        : session.status === 'denied'
          ? 'The host did not admit you.'
          : session.status === 'removed'
            ? 'The host removed you from the meeting.'
            : session.error || 'The meeting is unavailable.'
    return (
      <div className="room center-note">
        <div className="panel dark-card">
          <h2 data-testid="meeting-ended">{copy}</h2>
          <button className="btn" type="button" onClick={() => navigate('/')}>
            Back home
          </button>
        </div>
      </div>
    )
  }

  const peers = [...session.peers.values()]
  const sharer = peers.find((peer) => peer.screen.getVideoTracks().some((track) => track.readyState === 'live'))
  const localSharing = Boolean(session.screenStream)
  const presenting = localSharing || Boolean(sharer)
  const peopleCount = peers.length + 1
  const hands = peers.filter((peer) => peer.info.raised).length + (session.raised ? 1 : 0)
  const link = shareLink(session)
  const hostRecord = session.self?.isHost ? readHost() : null

  return (
    <div className={idle ? 'room idle' : 'room'}>
      <header className="room-top">
        <div>
          <strong data-testid="meeting-title">{session.meeting?.title || handoff.title}</strong>
          <span className="dot" />
          <span data-testid="meeting-timer">{formatClock(now - started.current)}</span>
        </div>
        <div className="room-top-actions">
          {recording && (
            <span className="rec" data-testid="recording-indicator">
              Rec {formatClock(now - recordFrom)}
            </span>
          )}
          <span className="pill subtle">{session.meeting?.allowStun ? 'Peer to peer' : 'Direct only'}</span>
          <span className="pill subtle">{peopleCount} in the call</span>
        </div>
      </header>
      {localSharing && (
        <div className="presenting" data-testid="presenting-banner">
          You are presenting
          <button type="button" onClick={() => void session.stopScreen()}>
            Stop sharing
          </button>
        </div>
      )}
      <div className="room-body">
        <div className="stage-wrap">
          {presenting ? (
            <>
              <div className="stage" data-testid="screen-stage" data-screen="true">
                {localSharing ? (
                  <MediaView stream={session.screenStream} muted recordLabel="Your screen" />
                ) : sharer ? (
                  <MediaView stream={sharer.screen} version={sharer.mediaVersion} recordLabel={`${sharer.info.name} screen`} speakerId={prefs.speakerId} />
                ) : null}
                <span className="namebar">{localSharing ? 'Your screen' : `${sharer?.info.name ?? 'Guest'} is presenting`}</span>
              </div>
              <div className="film">
                <SelfTile session={session} mirror={prefs.mirror} speakerId={prefs.speakerId} pinned={pinned} onPin={setPinned} />
                {peers.map((peer) => (
                  <PeerTile key={peer.info.id} peer={peer} speakerId={prefs.speakerId} pinned={pinned} onPin={setPinned} />
                ))}
              </div>
            </>
          ) : layout === 'speaker' ? (
            <SpeakerLayout session={session} peers={peers} pinned={pinned} onPin={setPinned} mirror={prefs.mirror} speakerId={prefs.speakerId} />
          ) : (
            <div className="grid" style={{ ['--cols' as string]: String(columns(peopleCount)) }} data-testid="gallery">
              <SelfTile session={session} mirror={prefs.mirror} speakerId={prefs.speakerId} pinned={pinned} onPin={setPinned} />
              {peers.map((peer) => (
                <PeerTile key={peer.info.id} peer={peer} speakerId={prefs.speakerId} pinned={pinned} onPin={setPinned} />
              ))}
            </div>
          )}
        </div>
        {panel === 'chat' && (
          <aside className="drawer" data-testid="chat-panel">
            <header>
              <h2>Chat</h2>
              <button type="button" onClick={() => setPanel('none')} aria-label="Close chat">
                Close
              </button>
            </header>
            <div className="chat-log" ref={chatRef} data-testid="chat-log">
              {session.chat.length === 0 && <p className="hint">Say hello. Messages stay on this computer for the meeting.</p>}
              {session.chat.map((message) => (
                <article key={message.id} className="chat-line" data-testid="chat-line">
                  <strong>{message.fromName}</strong>
                  <time>{new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                session.sendChat(draft)
                setDraft('')
              }}
            >
              <textarea
                data-testid="chat-input"
                value={draft}
                maxLength={2000}
                placeholder="Send a message"
                rows={2}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    session.sendChat(draft)
                    setDraft('')
                  }
                }}
              />
              <button className="btn primary" type="submit" data-testid="chat-send">
                Send
              </button>
            </form>
          </aside>
        )}
        {panel === 'people' && (
          <aside className="drawer" data-testid="people-list">
            <header>
              <h2>People</h2>
              <button type="button" onClick={() => setPanel('none')} aria-label="Close people">
                Close
              </button>
            </header>
            <div className="people-scroll">
              {session.self && <PersonRow info={{ ...session.self, mic: session.micOn, cam: session.camOn, raised: session.raised, sharing: Boolean(session.screenStream) }} self />}
              {session.waiting.length > 0 && <p className="kicker">Waiting</p>}
              {session.waiting.map((person) => (
                <div key={person.id} className="person">
                  <Avatar name={person.name} />
                  <div>
                    <strong>{person.name}</strong>
                    <small>Waiting to join</small>
                  </div>
                  {session.self?.isHost && (
                    <div className="person-actions">
                      <button type="button" data-testid="admit" onClick={() => session.host('admit', person.id)}>
                        Admit
                      </button>
                      <button type="button" data-testid="deny" onClick={() => session.host('deny', person.id)}>
                        Deny
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {peers.map((peer) => (
                <PersonRow
                  key={peer.info.id}
                  info={peer.info}
                  hostActions={session.self?.isHost}
                  onMute={() => session.host('mute', peer.info.id)}
                  onRemove={() => session.host('remove', peer.info.id)}
                />
              ))}
            </div>
          </aside>
        )}
      </div>
      <div className="fly-layer" aria-hidden="true">
        {reactions.map((reaction) => (
          <span key={reaction.id} className="fly" data-testid="reaction-fly">
            <em>{reaction.emoji}</em>
            {reaction.fromName}
          </span>
        ))}
      </div>
      <footer className="controls">
        <button className={session.micOn ? 'ctrl' : 'ctrl off'} type="button" data-testid="control-mic" onClick={() => void session.setMic(!session.micOn)} aria-label={session.micOn ? 'Mute microphone' : 'Unmute microphone'}>
          <Icon name={session.micOn ? 'mic' : 'mic-off'} />
          <span>{session.micOn ? 'Mute' : 'Unmute'}</span>
        </button>
        <button className={session.camOn ? 'ctrl' : 'ctrl off'} type="button" data-testid="control-cam" onClick={() => void toggleCam()} aria-label={session.camOn ? 'Turn camera off' : 'Turn camera on'}>
          <Icon name={session.camOn ? 'cam' : 'cam-off'} />
          <span>{session.camOn ? 'Stop video' : 'Start video'}</span>
        </button>
        <button className={localSharing ? 'ctrl on' : 'ctrl'} type="button" data-testid="control-share" onClick={() => void beginShare()}>
          <Icon name="screen" />
          <span>{localSharing ? 'Stop share' : 'Share'}</span>
        </button>
        <button className={session.raised ? 'ctrl on' : 'ctrl'} type="button" data-testid="control-hand" onClick={() => session.setRaised(!session.raised)}>
          <Icon name="hand" />
          <span>Raise</span>
          {hands > 0 && <i className="count">{hands}</i>}
        </button>
        <div className="react-wrap">
          <button className="ctrl" type="button" data-testid="control-react" onClick={() => setPanel((current) => (current === 'more' ? 'none' : current))}>
            <span className="emoji-btn" aria-hidden="true">
              🙂
            </span>
            <span>React</span>
          </button>
          <div className="react-pop">
            {REACTIONS.map((emoji) => (
              <button key={emoji} type="button" data-testid={`reaction-${emoji}`} onClick={() => session.react(emoji)}>
                {emoji}
              </button>
            ))}
          </div>
        </div>
        <button
          className={panel === 'chat' ? 'ctrl on' : 'ctrl'}
          type="button"
          data-testid="control-chat"
          onClick={() => {
            setUnread(0)
            setPanel((current) => (current === 'chat' ? 'none' : 'chat'))
          }}
        >
          <Icon name="chat" />
          <span>Chat</span>
          {unread > 0 && <i className="count">{unread}</i>}
        </button>
        <button className={panel === 'people' ? 'ctrl on' : 'ctrl'} type="button" data-testid="control-people" onClick={() => setPanel((current) => (current === 'people' ? 'none' : 'people'))}>
          <Icon name="people" />
          <span>People</span>
        </button>
        <div className="react-wrap">
          <button className={panel === 'more' ? 'ctrl on' : 'ctrl'} type="button" data-testid="control-more" onClick={() => setPanel((current) => (current === 'more' ? 'none' : 'more'))}>
            <Icon name="more" />
            <span>More</span>
          </button>
          {panel === 'more' && (
            <div className="menu" data-testid="more-menu">
              <button type="button" data-testid="menu-record" onClick={() => void toggleRecord()}>
                {recording ? 'Stop recording' : 'Record meeting'}
              </button>
              <button type="button" data-testid="menu-gallery" onClick={() => { setLayout('gallery'); setPanel('none') }}>
                Gallery view
              </button>
              <button type="button" data-testid="menu-speaker" onClick={() => { setLayout('speaker'); setPanel('none') }}>
                Speaker view
              </button>
              <button type="button" data-testid="menu-fullscreen" onClick={() => void toggleFullscreen()}>
                Full screen
              </button>
              <button
                type="button"
                data-testid="menu-settings"
                onClick={() => {
                  void navigator.mediaDevices.enumerateDevices().then(setDevices)
                  setDialog('settings')
                  setPanel('none')
                }}
              >
                Settings
              </button>
              <button type="button" data-testid="menu-shortcuts" onClick={() => { setDialog('shortcuts'); setPanel('none') }}>
                Keyboard shortcuts
              </button>
              <button
                type="button"
                data-testid="menu-details"
                onClick={() => {
                  if (link) void QRCode.toDataURL(link, { margin: 1, width: 240 }).then(setQr)
                  setDialog('details')
                  setPanel('none')
                }}
              >
                Meeting details
              </button>
              {session.self?.isHost && (
                <>
                  <button type="button" data-testid="menu-lock" onClick={() => session.host('lock', undefined, !session.meeting?.locked)}>
                    {session.meeting?.locked ? 'Unlock meeting' : 'Lock meeting'}
                  </button>
                  <button type="button" data-testid="menu-waiting" onClick={() => session.host('waiting-room', undefined, !session.meeting?.waitingRoom)}>
                    {session.meeting?.waitingRoom ? 'Turn waiting room off' : 'Turn waiting room on'}
                  </button>
                  <button type="button" data-testid="menu-end" onClick={() => setDialog('leave')}>
                    End meeting for everyone
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <button className="ctrl leave" type="button" data-testid="control-leave" onClick={() => setDialog('leave')}>
          <Icon name="leave" />
          <span>Leave</span>
        </button>
      </footer>
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast" data-testid="toast">
            {toast.text}
          </div>
        ))}
      </div>
      {dialog === 'share' && (
        <ScreenPicker
          onClose={() => setDialog('none')}
          onShare={(stream) => {
            void session.startScreen(stream)
            setDialog('none')
          }}
        />
      )}
      {dialog === 'leave' && (
        <div className="modal-back">
          <div className="modal" role="dialog" aria-modal="true">
            <h2>Leave this meeting?</h2>
            <p>You can come back with the link while the host still has it open.</p>
            <footer className="modal-actions">
              <button className="btn ghost" type="button" onClick={() => setDialog('none')}>
                Stay
              </button>
              <button className="btn" type="button" data-testid="confirm-leave" onClick={() => leave(false)}>
                Leave
              </button>
              {session.self?.isHost && (
                <button className="btn danger" type="button" data-testid="confirm-end" onClick={() => leave(true)}>
                  End for everyone
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
      {dialog === 'shortcuts' && (
        <div className="modal-back" onClick={() => setDialog('none')}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2>Keyboard shortcuts</h2>
            <ul className="shortcuts">
              <li><kbd>Ctrl</kbd> + <kbd>D</kbd> Mute microphone</li>
              <li><kbd>Ctrl</kbd> + <kbd>E</kbd> Camera</li>
              <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> Share screen</li>
              <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> Chat</li>
              <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>H</kbd> Raise hand</li>
              <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> Full screen</li>
              <li><kbd>Esc</kbd> Close panels</li>
            </ul>
            <button className="btn" type="button" onClick={() => setDialog('none')}>
              Done
            </button>
          </div>
        </div>
      )}
      {dialog === 'settings' && (
        <div className="modal-back">
          <div className="modal" role="dialog" aria-modal="true">
            <h2>Settings</h2>
            <label className="field">
              <span>Microphone</span>
              <select value={prefs.micId} onChange={(event) => void changeDevice('mic', event.target.value)} data-testid="settings-mic">
                <option value="">System default</option>
                {devices.filter((device) => device.kind === 'audioinput').map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>{device.label || 'Microphone'}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Camera</span>
              <select value={prefs.camId} onChange={(event) => void changeDevice('cam', event.target.value)} data-testid="settings-cam">
                <option value="">System default</option>
                {devices.filter((device) => device.kind === 'videoinput').map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>{device.label || 'Camera'}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Speaker</span>
              <select
                value={prefs.speakerId}
                data-testid="settings-speaker"
                onChange={(event) => {
                  const next = { ...prefs, speakerId: event.target.value }
                  setPrefs(next)
                  savePrefs(next)
                }}
              >
                <option value="">System default</option>
                {devices.filter((device) => device.kind === 'audiooutput').map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>{device.label || 'Speaker'}</option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={prefs.mirror}
                onChange={(event) => {
                  const next = { ...prefs, mirror: event.target.checked }
                  setPrefs(next)
                  savePrefs(next)
                }}
              />
              Mirror my camera
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={prefs.processing}
                onChange={(event) => {
                  const next = { ...prefs, processing: event.target.checked }
                  setPrefs(next)
                  savePrefs(next)
                }}
              />
              Echo cancellation, noise suppression, and auto gain
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={prefs.saveData}
                data-testid="settings-save-data"
                onChange={(event) => {
                  const next = { ...prefs, saveData: event.target.checked }
                  setPrefs(next)
                  savePrefs(next)
                }}
              />
              Lower video quality to save bandwidth
            </label>
            <button className="btn" type="button" onClick={() => setDialog('none')}>
              Done
            </button>
          </div>
        </div>
      )}
      {dialog === 'details' && (
        <div className="modal-back">
          <div className="modal" role="dialog" aria-modal="true" data-testid="details-dialog">
            <h2>Meeting details</h2>
            {link && <code className="mono block">{link}</code>}
            {qr && <img className="qr" src={qr} alt="" />}
            {hostRecord?.password && (
              <p>
                Password <strong>{hostRecord.password}</strong>
              </p>
            )}
            {hostRecord?.fingerprint && <p className="fine">Fingerprint {hostRecord.fingerprint}</p>}
            <p className="hint">People need to reach the address in the link, usually over the same VPN or local network. Browsers will ask them to trust this computer’s certificate once.</p>
            {session.self?.isHost && session.meeting?.linkMode === 'temp' && (
              <button className="btn ghost" type="button" onClick={() => session.host('regenerate-temp')}>
                Replace temporary link
              </button>
            )}
            <button className="btn" type="button" onClick={() => link && void navigator.clipboard.writeText(link)}>
              Copy link
            </button>
            <button className="btn ghost" type="button" onClick={() => setDialog('none')}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SelfTile({ session, mirror, speakerId, pinned, onPin }: { session: RoomSession; mirror: boolean; speakerId: string; pinned: string; onPin: (id: string) => void }) {
  const speaking = useSpeaking(session.localStream, session.micOn)
  return (
    <TileFrame
      name={session.self?.name || 'You'}
      self
      micOn={session.micOn}
      camOn={session.camOn}
      raised={session.raised}
      speaking={speaking}
      host={session.self?.isHost}
      pinned={pinned === 'self'}
      onPin={() => onPin(pinned === 'self' ? '' : 'self')}
    >
      <MediaView stream={session.localStream} muted mirror={mirror && session.camOn} speakerId={speakerId} recordLabel={session.self?.name || 'You'} />
      {!session.camOn && <Avatar name={session.self?.name || 'You'} large />}
    </TileFrame>
  )
}

function PeerTile({ peer, speakerId, pinned, onPin }: { peer: PeerView; speakerId: string; pinned: string; onPin: (id: string) => void }) {
  const speaking = useSpeaking(peer.audio, peer.info.mic, peer.mediaVersion)
  const showCam = peer.info.cam && peer.camera.getVideoTracks().length > 0
  return (
    <TileFrame
      name={peer.info.name}
      micOn={peer.info.mic}
      camOn={peer.info.cam}
      raised={peer.info.raised}
      speaking={speaking}
      host={peer.info.isHost}
      connection={peer.connection}
      pinned={pinned === peer.info.id}
      onPin={() => onPin(pinned === peer.info.id ? '' : peer.info.id)}
    >
      <audio
        ref={(element) => {
          if (!element) return
          if (element.srcObject !== peer.audio) element.srcObject = peer.audio
          void element.play().catch(() => undefined)
          const sink = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
          if (speakerId && sink.setSinkId) void sink.setSinkId(speakerId).catch(() => undefined)
        }}
        autoPlay
        data-testid="remote-audio"
      />
      {showCam && <MediaView stream={peer.camera} muted version={peer.mediaVersion} speakerId={speakerId} recordLabel={peer.info.name} />}
      {!showCam && <Avatar name={peer.info.name} large />}
    </TileFrame>
  )
}

function TileFrame({
  name,
  self,
  micOn,
  camOn,
  raised,
  speaking,
  host,
  connection,
  pinned,
  onPin,
  children,
}: {
  name: string
  self?: boolean
  micOn: boolean
  camOn: boolean
  raised: boolean
  speaking: boolean
  host?: boolean
  connection?: string
  pinned?: boolean
  onPin: () => void
  children: ReactNode
}) {
  return (
    <article className={speaking ? 'tile speaking' : 'tile'} data-testid="tile" data-name={name} data-speaking={speaking ? 'true' : 'false'}>
      {children}
      {!camOn && <span className="tile-cover" />}
      <button className="pin" type="button" onClick={onPin}>
        {pinned ? 'Unpin' : 'Pin'}
      </button>
      <span className="namebar">
        {raised && <em data-testid="hand-badge">Hand</em>}
        {host && <em>Host</em>}
        {self ? `${name} (You)` : name}
        {!micOn && <em>Muted</em>}
        {connection && connection !== 'connected' && connection !== 'new' && <em>{connection}</em>}
      </span>
    </article>
  )
}

function SpeakerLayout({
  session,
  peers,
  pinned,
  onPin,
  mirror,
  speakerId,
}: {
  session: RoomSession
  peers: PeerView[]
  pinned: string
  onPin: (id: string) => void
  mirror: boolean
  speakerId: string
}) {
  const active = peers.find((peer) => peer.info.id === pinned) || peers.find((peer) => peer.info.mic) || peers[0]
  const rest = peers.filter((peer) => peer !== active)
  return (
    <>
      <div className="stage" data-testid="speaker-stage">
        {pinned === 'self' || !active ? (
          <SelfTile session={session} mirror={mirror} speakerId={speakerId} pinned={pinned} onPin={onPin} />
        ) : (
          <PeerTile peer={active} speakerId={speakerId} pinned={pinned} onPin={onPin} />
        )}
      </div>
      <div className="film">
        {pinned !== 'self' && active && <SelfTile session={session} mirror={mirror} speakerId={speakerId} pinned={pinned} onPin={onPin} />}
        {rest.map((peer) => (
          <PeerTile key={peer.info.id} peer={peer} speakerId={speakerId} pinned={pinned} onPin={onPin} />
        ))}
      </div>
    </>
  )
}

function PersonRow({ info, self, hostActions, onMute, onRemove }: { info: PeerInfo; self?: boolean; hostActions?: boolean; onMute?: () => void; onRemove?: () => void }) {
  return (
    <div className="person" data-peer-id={info.id}>
      <Avatar name={info.name} />
      <div>
        <strong>
          {info.name}
          {self ? ' (You)' : ''}
        </strong>
        <small>
          {info.isHost ? 'Host' : 'Guest'}
          {info.raised ? ' · Hand raised' : ''}
          {!info.mic ? ' · Muted' : ''}
          {info.sharing ? ' · Presenting' : ''}
        </small>
      </div>
      {hostActions && !self && (
        <div className="person-actions">
          <button type="button" data-testid="mute-person" onClick={onMute}>
            Mute
          </button>
          <button type="button" data-testid="remove-person" onClick={onRemove}>
            Remove
          </button>
        </div>
      )}
    </div>
  )
}

function shareLink(session: RoomSession): string {
  const host = readHost()
  if (session.self?.isHost && host?.shareUrl) return host.shareUrl
  const target = readJoinTarget()
  if (!target) return ''
  if (target.tempToken) return `${target.httpBase}/t/${target.tempToken}`
  if (target.meetingId) return `${target.httpBase}/m/${target.meetingId}`
  return ''
}

function columns(count: number): number {
  if (count <= 1) return 1
  if (count <= 4) return 2
  if (count <= 9) return 3
  return 4
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`
}

async function toggleFullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen()
  else await document.documentElement.requestFullscreen()
}

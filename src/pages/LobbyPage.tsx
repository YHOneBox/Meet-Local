import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { errorCopy, getMeetingInfo, type MeetingInfo } from '../api'
import { loadPrefs, publishPrefs, type Prefs } from '../prefs'
import { openDevices } from '../session'
import { hostMatches, readHost, rememberName, savedName, saveJoinTarget, setHandoff, type JoinTarget } from '../store'
import { parseMeetingLink } from '../../shared/urls'
import { Avatar } from '../ui'

export function LobbyPage() {
  const navigate = useNavigate()
  const params = useParams()
  const [search] = useSearchParams()
  const target = useMemo(() => resolveTarget(params.meetingId, params.token, search.get('u')), [params.meetingId, params.token, search])
  const host = target ? hostMatches(target, readHost()) : false
  const [info, setInfo] = useState<MeetingInfo | null>(null)
  const [loadError, setLoadError] = useState('')
  const [name, setName] = useState(savedName())
  const [password, setPassword] = useState('')
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs())
  const [micOn, setMicOn] = useState(() => loadPrefs().micOn)
  const [camOn, setCamOn] = useState(() => loadPrefs().camOn)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [mediaError, setMediaError] = useState('')
  const [level, setLevel] = useState(0)
  const [joining, setJoining] = useState(false)
  const [mediaReady, setMediaReady] = useState(false)
  const [pendingTrust, setPendingTrust] = useState<{ host: string; fingerprint: string; next: string } | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    if (!target) {
      setLoadError('This meeting link is not valid.')
      return
    }
    let cancel = false
    const remoteHost = new URL(target.httpBase).host
    if (remoteHost !== window.location.host) {
      const path = target.tempToken ? `/t/${target.tempToken}` : `/m/${target.meetingId}`
      const next = `${target.httpBase}${path}`
      if (!window.meetlocal?.inspectCertificate) {
        window.location.assign(next)
        return
      }
      window.meetlocal
        .inspectCertificate(target.httpBase)
        .then((report) => {
          if (cancel) return
          if (report.trusted) window.location.assign(next)
          else setPendingTrust({ host: report.host, fingerprint: report.fingerprint, next })
        })
        .catch((error: Error) => {
          if (!cancel) setLoadError(error.message)
        })
      return () => {
        cancel = true
      }
    }
    saveJoinTarget(target)
    const secret = host ? readHost()?.hostSecret : undefined
    getMeetingInfo(target.httpBase, target, secret)
      .then((meeting) => {
        if (cancel) return
        setInfo(meeting)
        document.title = `${meeting.title} · MeetLocal`
      })
      .catch((error: Error) => {
        if (!cancel) setLoadError(errorCopy(error.message))
      })
    return () => {
      cancel = true
    }
  }, [target, host])

  useEffect(() => {
    let cancelled = false
    let meterTimer = 0
    setMediaReady(false)
    async function start() {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      try {
        const next = await openDevices({
          micId: prefs.micId,
          camId: prefs.camId,
          wantMic: micOn,
          wantCam: camOn,
          saveData: prefs.saveData,
          processing: prefs.processing,
        })
        if (cancelled) {
          next.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = next
        setStream(next)
        setMediaError('')
        const listed = await navigator.mediaDevices.enumerateDevices()
        if (!cancelled) setDevices(listed)
        const audio = next.getAudioTracks()[0]
        if (!audio) return undefined
        const context = new AudioContext()
        const source = context.createMediaStreamSource(new MediaStream([audio]))
        const analyser = context.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        const data = new Uint8Array(analyser.fftSize)
        meterTimer = window.setInterval(() => {
          analyser.getByteTimeDomainData(data)
          let sum = 0
          for (let i = 0; i < data.length; i += 1) {
            const value = (data[i] - 128) / 128
            sum += value * value
          }
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4))
        }, 120)
        return () => {
          window.clearInterval(meterTimer)
          source.disconnect()
          void context.close()
        }
      } catch {
        if (!cancelled) {
          const empty = new MediaStream()
          streamRef.current = empty
          setStream(empty)
          setMediaError('Camera or microphone permission was blocked. You can still join.')
        }
      } finally {
        if (!cancelled) setMediaReady(true)
      }
      return undefined
    }
    let cleanup: (() => void) | undefined
    void start().then((done) => {
      cleanup = done
    })
    return () => {
      cancelled = true
      window.clearInterval(meterTimer)
      cleanup?.()
    }
  }, [micOn, camOn, prefs.micId, prefs.camId, prefs.saveData, prefs.processing])

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), [])

  function updatePrefs(next: Partial<Prefs>) {
    const value = { ...prefs, ...next }
    setPrefs(value)
    void publishPrefs(value)
  }

  function join() {
    if (!target || !info) return
    const trimmed = name.trim()
    if (!trimmed) return
    rememberName(trimmed)
    const live = streamRef.current ?? new MediaStream()
    streamRef.current = null
    setHandoff({
      name: trimmed,
      stream: live,
      micOn: micOn && live.getAudioTracks().length > 0,
      camOn: camOn && live.getVideoTracks().length > 0,
      speakerId: prefs.speakerId,
      target,
      password: password || undefined,
      hostSecret: host ? readHost()?.hostSecret : undefined,
      title: info.title,
    })
    setJoining(true)
    navigate('/room')
  }

  if (pendingTrust) {
    return (
      <div className="shell narrow">
        <div className="panel">
          <p className="kicker">Encrypted link</p>
          <h2>Compare this fingerprint</h2>
          <p className="hint">Ask the host to read the fingerprint from their MeetLocal window. Continue only when the two match.</p>
          <p className="mono block" data-testid="trust-fingerprint">
            {pendingTrust.fingerprint}
          </p>
          <div className="modal-actions">
            <button className="btn ghost" type="button" onClick={() => navigate('/')}>
              Cancel
            </button>
            <button
              className="btn primary"
              type="button"
              data-testid="trust-confirm"
              onClick={() => {
                void window.meetlocal?.trustCertificate(pendingTrust.host, pendingTrust.fingerprint).then(() => {
                  window.location.assign(pendingTrust.next)
                })
              }}
            >
              Fingerprints match
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="shell narrow">
        <div className="panel">
          <h2>Cannot open this meeting</h2>
          <p className="error" data-testid="join-error">
            {loadError}
          </p>
          <button className="btn" type="button" onClick={() => navigate('/')}>
            Back home
          </button>
        </div>
      </div>
    )
  }

  if (!info || !target) {
    return (
      <div className="shell narrow">
        <p className="hint">Opening the meeting…</p>
      </div>
    )
  }

  const mics = devices.filter((device) => device.kind === 'audioinput')
  const cams = devices.filter((device) => device.kind === 'videoinput')
  const speakers = devices.filter((device) => device.kind === 'audiooutput')
  const needsPassword = info.requiresPassword && !info.isHost

  return (
    <div className="shell narrow">
      <header className="topbar">
        <button className="brand buttonish" type="button" onClick={() => navigate('/')}>
          Meet<em>Local</em>
        </button>
      </header>
      <main className="lobby">
        <section className="preview-card">
          <div className="preview">
            {camOn && stream && stream.getVideoTracks().length > 0 ? (
              <video
                ref={(element) => {
                  if (element && element.srcObject !== stream) element.srcObject = stream
                }}
                autoPlay
                muted
                playsInline
                className={prefs.mirror ? 'mirror' : undefined}
              />
            ) : (
              <Avatar name={name || 'You'} large />
            )}
            <div className="preview-controls">
              <button className={micOn ? 'ctrl' : 'ctrl off'} type="button" data-testid="toggle-mic" onClick={() => setMicOn((value) => !value)} aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}>
                {micOn ? 'Mic on' : 'Mic off'}
              </button>
              <button className={camOn ? 'ctrl' : 'ctrl off'} type="button" data-testid="toggle-cam" onClick={() => setCamOn((value) => !value)} aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}>
                {camOn ? 'Camera on' : 'Camera off'}
              </button>
            </div>
          </div>
          <div className="meter" aria-hidden="true">
            <span style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          {mediaError && <p className="hint">{mediaError}</p>}
        </section>
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault()
            join()
          }}
        >
          <p className="kicker">Ready to join</p>
          <h2>{info.title}</h2>
          <label className="field">
            <span>Your name</span>
            <input data-testid="prejoin-name" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="What should people call you?" />
          </label>
          {needsPassword && (
            <label className="field">
              <span>Password</span>
              <input data-testid="prejoin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
          )}
          <label className="field">
            <span>Microphone</span>
            <select value={prefs.micId} onChange={(event) => updatePrefs({ micId: event.target.value })}>
              <option value="">System default</option>
              {mics.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || 'Microphone'}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Camera</span>
            <select value={prefs.camId} onChange={(event) => updatePrefs({ camId: event.target.value })}>
              <option value="">System default</option>
              {cams.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || 'Camera'}
                </option>
              ))}
            </select>
          </label>
          {speakers.length > 0 && (
            <label className="field">
              <span>Speaker</span>
              <select value={prefs.speakerId} onChange={(event) => updatePrefs({ speakerId: event.target.value })}>
                <option value="">System default</option>
                {speakers.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || 'Speaker'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="fine">
            Voice and video are encrypted. Compare this certificate with the host: <span className="mono">{info.fingerprint}</span>
          </p>
          <button className="btn primary wide" type="submit" disabled={joining || !mediaReady || name.trim().length === 0 || (needsPassword && password.length === 0)} data-testid="prejoin-join">
            {joining ? 'Joining…' : 'Join meeting'}
          </button>
        </form>
      </main>
    </div>
  )
}

function resolveTarget(meetingId?: string, token?: string, external?: string | null): JoinTarget | null {
  if (external) return parseMeetingLink(external, window.location.origin)
  if (token) return { httpBase: window.location.origin, tempToken: token }
  if (meetingId) return { httpBase: window.location.origin, meetingId }
  return null
}

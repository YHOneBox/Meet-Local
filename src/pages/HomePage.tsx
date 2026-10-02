import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { createMeeting, endMeetingHttp, errorCopy, getMeetingInfo, getSession, updateLinkMode, type InterfaceInfo } from '../api'
import { UpdateCard } from './UpdateCard'
import { STRENGTH_LABEL, generatePassword, parseMeetingLink, passwordStrength } from '../../shared/urls'
import { clearHost, readHost, saveHost, saveJoinTarget, type CreatedView } from '../store'

export function HomePage() {
  const navigate = useNavigate()
  const [interfaces, setInterfaces] = useState<InterfaceInfo[]>([])
  const [canHost, setCanHost] = useState(true)
  const [fingerprint, setFingerprint] = useState('')
  const [title, setTitle] = useState('Quick meeting')
  const [usePassword, setUsePassword] = useState(false)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [waitingRoom, setWaitingRoom] = useState(false)
  const [allowStun, setAllowStun] = useState(true)
  const [linkMode, setLinkMode] = useState<'network' | 'temp'>('network')
  const [address, setAddress] = useState('')
  const [created, setCreated] = useState<CreatedView | null>(null)
  const [selectedUrl, setSelectedUrl] = useState('')
  const [qr, setQr] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [joinInput, setJoinInput] = useState('')
  const [joinError, setJoinError] = useState('')
  const [copied, setCopied] = useState('')
  const [resume, setResume] = useState(false)

  useEffect(() => {
    document.title = 'MeetLocal'
    getSession()
      .then((session) => {
        setCanHost(session.canHost)
        setInterfaces(session.interfaces)
        setFingerprint(session.fingerprint)
        const preferred = session.interfaces.find((item) => item.kind === 'vpn') || session.interfaces[0]
        if (preferred) setAddress(preferred.address)
      })
      .catch(() => setError('The meeting service is not running.'))
    const host = readHost()
    if (!host) return
    const target = host.linkMode === 'temp' ? { tempToken: host.tempToken } : { meetingId: host.meetingId }
    getMeetingInfo(window.location.origin, target, host.hostSecret)
      .then(() => setResume(true))
      .catch(() => {
        clearHost()
        setResume(false)
      })
  }, [])

  useEffect(() => {
    if (!selectedUrl) {
      setQr('')
      return
    }
    QRCode.toDataURL(selectedUrl, { margin: 1, width: 280, color: { dark: '#1c1915', light: '#fffcf7' } })
      .then(setQr)
      .catch(() => setQr(''))
  }, [selectedUrl])

  const strength = passwordStrength(usePassword ? password : '')
  const vpnCount = interfaces.filter((item) => item.kind === 'vpn').length

  const selectedLink = useMemo(() => created?.links.find((link) => link.url === selectedUrl) ?? created?.links[0], [created, selectedUrl])

  async function onCreate() {
    setBusy(true)
    setError('')
    try {
      const previous = readHost()
      if (previous) {
        await endMeetingHttp(previous.meetingId, previous.hostSecret).catch(() => undefined)
        clearHost()
      }
      const result = await createMeeting({
        title,
        password: usePassword ? password : '',
        waitingRoom,
        linkMode,
        allowStun,
        preferredAddress: address,
      })
      const view: CreatedView = { ...result, password: usePassword ? password : '' }
      setCreated(view)
      setSelectedUrl(result.links[0]?.url || '')
      saveHost({
        meetingId: result.meetingId,
        tempToken: result.tempToken,
        hostSecret: result.hostSecret,
        linkMode: result.linkMode,
        enterPath: result.enterPath,
        title: result.title,
        password: usePassword ? password : '',
        shareUrl: result.links[0]?.url || '',
        fingerprint: result.fingerprint,
      })
    } catch (err) {
      setError(errorCopy(err instanceof Error ? err.message : ''))
    } finally {
      setBusy(false)
    }
  }

  async function switchMode(mode: 'network' | 'temp') {
    if (!created) return
    setBusy(true)
    try {
      const next = await updateLinkMode(created.meetingId, created.hostSecret, mode)
      const view = { ...created, ...next }
      setCreated(view)
      setLinkMode(mode)
      setSelectedUrl(next.links[0]?.url || '')
      saveHost({
        meetingId: view.meetingId,
        tempToken: view.tempToken,
        hostSecret: view.hostSecret,
        linkMode: view.linkMode,
        enterPath: view.enterPath,
        title: view.title,
        password: view.password,
        shareUrl: next.links[0]?.url || '',
        fingerprint: view.fingerprint,
      })
    } catch (err) {
      setError(errorCopy(err instanceof Error ? err.message : ''))
    } finally {
      setBusy(false)
    }
  }

  async function discard() {
    if (!created) return
    await endMeetingHttp(created.meetingId, created.hostSecret).catch(() => undefined)
    clearHost()
    setCreated(null)
    setResume(false)
  }

  function enter() {
    if (!created) return
    saveJoinTarget({
      httpBase: window.location.origin,
      meetingId: created.linkMode === 'network' ? created.meetingId : undefined,
      tempToken: created.linkMode === 'temp' ? created.tempToken : undefined,
      title: created.title,
    })
    navigate(created.enterPath)
  }

  function resumeMeeting() {
    const host = readHost()
    if (!host) return
    saveJoinTarget({
      httpBase: window.location.origin,
      meetingId: host.linkMode === 'network' ? host.meetingId : undefined,
      tempToken: host.linkMode === 'temp' ? host.tempToken : undefined,
      title: host.title,
    })
    navigate(host.enterPath)
  }

  function joinExisting() {
    const parsed = parseMeetingLink(joinInput, window.location.origin)
    if (!parsed) {
      setJoinError('Paste a full MeetLocal link.')
      return
    }
    saveJoinTarget(parsed)
    if (parsed.httpBase === window.location.origin) {
      navigate(parsed.tempToken ? `/t/${parsed.tempToken}` : `/m/${parsed.meetingId}`)
      return
    }
    navigate(`/join?u=${encodeURIComponent(joinInput.trim())}`)
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const area = document.createElement('textarea')
      area.value = value
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setCopied(label)
    window.setTimeout(() => setCopied(''), 1600)
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          Meet<em>Local</em>
        </div>
        <span className="pill">Hosted on this computer</span>
      </header>
      <main className="home-grid">
        <section className="hero-copy">
          <p className="kicker">Voice, video, and screen sharing</p>
          <h1>Meet on your own network.</h1>
          <p className="lede">
            Start a call from this device, then hand someone a VPN address or a temporary link. Audio and video travel directly between the people in the call.
          </p>
          <ul className="facts">
            <li>Optional password, or a complex one generated for you.</li>
            <li>Share a whole screen or a single window.</li>
            <li>The temporary link stops working when the meeting ends.</li>
          </ul>
        </section>
        <section className="stack">
          <UpdateCard />
          {resume && !created && (
            <div className="banner-card">
              <div>
                <strong>Your meeting is still open</strong>
                <p>Return to it, or end it before creating another.</p>
              </div>
              <button className="btn primary" type="button" onClick={resumeMeeting}>
                Return
              </button>
            </div>
          )}
          {!created && canHost && (
            <form
              className="panel"
              onSubmit={(event) => {
                event.preventDefault()
                void onCreate()
              }}
            >
              <h2>New meeting</h2>
              <label className="field">
                <span>Title</span>
                <input data-testid="meeting-title-input" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="check">
                <input data-testid="password-toggle" type="checkbox" checked={usePassword} onChange={(event) => setUsePassword(event.target.checked)} />
                Require a password
              </label>
              {usePassword && (
                <div className="field">
                  <span>Password</span>
                  <div className="inline">
                    <input
                      data-testid="password-input"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      maxLength={128}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Type one, or generate it"
                    />
                    <button className="btn ghost" type="button" onClick={() => setShowPassword((value) => !value)}>
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      data-testid="password-generate"
                      onClick={() => {
                        setPassword(generatePassword())
                        setShowPassword(true)
                      }}
                    >
                      Generate complex password
                    </button>
                  </div>
                  <div className="strength" data-score={strength} aria-label={STRENGTH_LABEL[strength]}>
                    <i />
                    <i />
                    <i />
                    <i />
                    <em>{STRENGTH_LABEL[strength]}</em>
                  </div>
                </div>
              )}
              <div className="field">
                <span>Link to share</span>
                <div className="segmented">
                  <button type="button" className={linkMode === 'network' ? 'active' : ''} data-testid="link-network" onClick={() => setLinkMode('network')}>
                    Address on this device
                  </button>
                  <button type="button" className={linkMode === 'temp' ? 'active' : ''} data-testid="link-temp" onClick={() => setLinkMode('temp')}>
                    Temporary link
                  </button>
                </div>
                <p className="hint">
                  {linkMode === 'temp'
                    ? 'A random link that stops working the moment the meeting ends. The meeting id is not in the link.'
                    : 'A stable link for this meeting, using the network address you pick below. It also stops working when you end the meeting.'}
                </p>
              </div>
              <div className="field">
                <span>Share over</span>
                {interfaces.length === 0 && <p className="hint">No LAN or VPN address was found. You can still open the meeting on this computer.</p>}
                <div className="choices">
                  {interfaces.map((item) => (
                    <label key={`${item.name}-${item.address}`} className={address === item.address ? 'choice active' : 'choice'}>
                      <input
                        type="radio"
                        name="address"
                        checked={address === item.address}
                        onChange={() => setAddress(item.address)}
                        data-testid="address-option"
                        data-kind={item.kind}
                        data-address={item.address}
                      />
                      <span className={`badge ${item.kind}`}>{item.kind === 'vpn' ? 'VPN' : item.kind === 'lan' ? 'Local network' : 'Other'}</span>
                      <strong>{item.label}</strong>
                      <em>{item.address}</em>
                      <small>{item.name}</small>
                    </label>
                  ))}
                </div>
                {vpnCount === 0 && interfaces.length > 0 && (
                  <p className="hint">No VPN adapter was detected. People need to be on the same local network as this computer.</p>
                )}
              </div>
              <label className="check">
                <input type="checkbox" checked={waitingRoom} onChange={(event) => setWaitingRoom(event.target.checked)} data-testid="waiting-toggle" />
                Ask me to admit people before they join
              </label>
              <label className="check">
                <input type="checkbox" checked={allowStun} onChange={(event) => setAllowStun(event.target.checked)} data-testid="allow-stun" />
                Use STUN if two devices cannot see each other directly. Media is still peer to peer.
              </label>
              {error && <p className="error">{error}</p>}
              <button className="btn primary wide" type="submit" disabled={busy || (usePassword && password.length < 4)} data-testid="create-meeting">
                {busy ? 'Creating…' : 'Create meeting'}
              </button>
            </form>
          )}
          {!created && !canHost && (
            <div className="panel">
              <h2>Join a meeting</h2>
              <p className="hint">This page was opened from another computer. Hosting stays on the machine running MeetLocal.</p>
            </div>
          )}
          {created && (
            <div className="panel share-panel">
              <p className="kicker">Ready to share</p>
              <h2>{created.title}</h2>
              <div className="segmented">
                <button type="button" className={created.linkMode === 'network' ? 'active' : ''} onClick={() => void switchMode('network')}>
                  Device address
                </button>
                <button type="button" className={created.linkMode === 'temp' ? 'active' : ''} onClick={() => void switchMode('temp')} data-testid="switch-temp">
                  Temporary link
                </button>
              </div>
              <p className="hint">
                {created.linkMode === 'temp'
                  ? 'This temporary link works only for this meeting. Ending the meeting retires it.'
                  : 'Pick the VPN or local address your friend can actually reach.'}
              </p>
              <div className="choices">
                {created.links.map((link) => (
                  <button
                    key={link.url}
                    type="button"
                    className={selectedUrl === link.url ? 'choice active' : 'choice'}
                    onClick={() => setSelectedUrl(link.url)}
                    data-testid="link-option"
                    data-kind={link.kind}
                  >
                    <span className={`badge ${link.kind}`}>{link.kind === 'vpn' ? 'VPN' : link.kind === 'lan' ? 'Local network' : 'Other'}</span>
                    <strong>{link.label}</strong>
                    <em>{link.address}</em>
                    <small>{link.kind === 'vpn' ? 'Use this when your friend is on the same VPN.' : 'Use this when your friend is on the same network.'}</small>
                  </button>
                ))}
              </div>
              {created.links.length === 0 && <p className="hint">There is no reachable network address yet. Join on this computer, then share a link after a VPN or LAN address appears.</p>}
              {selectedUrl && (
                <div className="url-box">
                  <code data-testid="share-url">{selectedUrl}</code>
                  <button className="btn ghost" type="button" data-testid="copy-link" onClick={() => void copy(selectedUrl, 'link')}>
                    {copied === 'link' ? 'Copied' : 'Copy link'}
                  </button>
                </div>
              )}
              {created.password && (
                <div className="url-box">
                  <span>
                    Password <strong data-testid="share-password">{created.password}</strong>
                  </span>
                  <button className="btn ghost" type="button" onClick={() => void copy(created.password, 'password')}>
                    {copied === 'password' ? 'Copied' : 'Copy password'}
                  </button>
                </div>
              )}
              {selectedLink && (
                <p className="hint">
                  The first time someone opens this in a browser, they need to trust this computer’s certificate. The certificate fingerprint is{' '}
                  <span className="mono" data-testid="fingerprint">
                    {created.fingerprint}
                  </span>
                  .
                </p>
              )}
              <div className="share-bottom">
                {qr && <img className="qr" src={qr} alt="QR code for the meeting link" />}
                <div className="modal-actions">
                  <button className="btn ghost" type="button" onClick={() => void discard()}>
                    Discard meeting
                  </button>
                  <button
                    className="btn primary"
                    type="button"
                    data-testid="enter-meeting"
                    data-path={created.enterPath}
                    onClick={enter}
                  >
                    Enter meeting
                  </button>
                </div>
              </div>
            </div>
          )}
          <form
            className="panel join-card"
            onSubmit={(event) => {
              event.preventDefault()
              joinExisting()
            }}
          >
            <h2>Join with a link</h2>
            <label className="field">
              <span>Meeting link</span>
              <input
                data-testid="join-input"
                value={joinInput}
                placeholder="https://…"
                onChange={(event) => {
                  setJoinInput(event.target.value)
                  setJoinError('')
                }}
              />
            </label>
            {joinError && <p className="error">{joinError}</p>}
            <button className="btn wide" type="submit" data-testid="join-continue">
              Continue
            </button>
          </form>
          {fingerprint && !created && (
            <p className="fine">
              This device fingerprint <span className="mono">{fingerprint}</span>
            </p>
          )}
        </section>
      </main>
    </div>
  )
}

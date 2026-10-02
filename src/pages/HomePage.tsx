import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { createMeeting, endMeetingHttp, errorCopy, getMeetingInfo, getSession, updateLinkMode, type InterfaceInfo } from '../api'
import { loadPrefs, publishPrefs, type Prefs } from '../prefs'
import { UpdateCard } from './UpdateCard'
import { SettingsFields } from './SettingsFields'
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
  const [waitingRoom, setWaitingRoom] = useState(() => loadPrefs().waitingRoom)
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs())
  const [allowStun, setAllowStun] = useState(false)
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
  const [browserNote, setBrowserNote] = useState('')
  const [view, setView] = useState<'home' | 'create' | 'join' | 'settings'>('home')
  const [showOptions, setShowOptions] = useState(false)

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
  const selectedInterface = interfaces.find((item) => item.address === address)

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
    void openMeeting({
      meetingId: created.meetingId,
      hostSecret: created.hostSecret,
      linkMode: created.linkMode,
      tempToken: created.tempToken,
      enterPath: created.enterPath,
      title: created.title,
    })
  }

  function resumeMeeting() {
    const host = readHost()
    if (!host) return
    void openMeeting(host)
  }

  async function openMeeting(record: { meetingId: string; hostSecret: string; linkMode: 'network' | 'temp'; tempToken: string; enterPath: string; title: string }) {
    if (window.meetlocal?.openHostedMeeting) {
      try {
        await window.meetlocal.openHostedMeeting(record.meetingId, record.hostSecret)
        setBrowserNote('The meeting is open in your browser. Keep this window open so the call stays hosted on this computer.')
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not open the browser.')
      }
      return
    }
    saveJoinTarget({
      httpBase: window.location.origin,
      meetingId: record.linkMode === 'network' ? record.meetingId : undefined,
      tempToken: record.linkMode === 'temp' ? record.tempToken : undefined,
      title: record.title,
    })
    navigate(record.enterPath)
  }

  function updatePrefs(next: Prefs) {
    setPrefs(next)
    setWaitingRoom(next.waitingRoom)
    void publishPrefs(next)
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
    <div className="shell home">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="MeetLocal" width="132" height="88" />
        </div>
        {!created && view !== 'settings' && (
          <button className="btn ghost" type="button" data-testid="open-settings" onClick={() => setView('settings')}>
            Settings
          </button>
        )}
      </header>
      <main className="stack">
        {created ? null : view === 'home' ? (
          <>
            <h1>Meet on your own network.</h1>
            <p className="hint">This window hosts the call. The meeting opens in your browser.</p>
            <UpdateCard />
            {resume && (
              <div className="banner-card">
                <div>
                  <strong>Your meeting is still open</strong>
                  <p>Return to it, or start another.</p>
                </div>
                <button className="btn primary" type="button" onClick={resumeMeeting}>
                  Return
                </button>
              </div>
            )}
            {canHost ? (
              <div className="home-actions">
                <button className="btn primary wide" type="button" data-testid="start-meeting" onClick={() => setView('create')}>
                  New meeting
                </button>
                <button className="btn wide" type="button" data-testid="open-join" onClick={() => setView('join')}>
                  Join with a link
                </button>
              </div>
            ) : (
              <form
                className="panel"
                onSubmit={(event) => {
                  event.preventDefault()
                  joinExisting()
                }}
              >
                <h2>Join a meeting</h2>
                <p className="hint">Hosting stays on the computer running MeetLocal.</p>
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
                <button className="btn primary wide" type="submit" data-testid="join-continue">
                  Continue
                </button>
              </form>
            )}
          </>
        ) : null}
        {!created && view === 'create' && canHost && (
            <form
              className="panel"
              onSubmit={(event) => {
                event.preventDefault()
                void onCreate()
              }}
            >
              <button className="text-back" type="button" data-testid="home-back" onClick={() => setView('home')}>
                Back
              </button>
              <h2>New meeting</h2>
              <label className="field">
                <span>Title</span>
                <input data-testid="meeting-title-input" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <div className="field">
                <span>Link to share</span>
                <div className="segmented">
                  <button type="button" className={linkMode === 'network' ? 'active' : ''} data-testid="link-network" onClick={() => setLinkMode('network')}>
                    This device
                  </button>
                  <button type="button" className={linkMode === 'temp' ? 'active' : ''} data-testid="link-temp" onClick={() => setLinkMode('temp')}>
                    Temporary link
                  </button>
                </div>
                <p className="hint">
                  {linkMode === 'temp'
                    ? 'A temporary address with no IP. It stops when the meeting ends.'
                    : selectedInterface
                      ? `Sharing over ${selectedInterface.label}.`
                      : 'People on your VPN or local network can join.'}
                </p>
              </div>
              <button className="btn ghost wide" type="button" data-testid="meeting-options" onClick={() => setShowOptions((open) => !open)}>
                {showOptions ? 'Hide options' : 'Options'}
              </button>
              {showOptions && (
                <>
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
              {linkMode === 'network' && (
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
              )}
              <label className="check">
                <input type="checkbox" checked={waitingRoom} onChange={(event) => setWaitingRoom(event.target.checked)} data-testid="waiting-toggle" />
                Ask me to admit people before they join
              </label>
              <label className="check">
                <input type="checkbox" checked={allowStun} onChange={(event) => setAllowStun(event.target.checked)} data-testid="allow-stun" />
                Help devices find each other. This does not carry the call.
              </label>
                </>
              )}
              {error && <p className="error">{error}</p>}
              <button className="btn primary wide" type="submit" disabled={busy || (usePassword && password.length < 8)} data-testid="create-meeting">
                {busy ? (linkMode === 'temp' ? 'Creating address…' : 'Creating…') : 'Create meeting'}
              </button>
            </form>
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
                  ? 'This address does not include your IP. It works only for this meeting, and ending the meeting retires it. The first temporary link downloads Cloudflare’s address helper.'
                  : 'Pick the VPN or local address your friend can actually reach.'}
              </p>
              {created.linkMode !== 'temp' && (
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
              )}
              {created.linkMode !== 'temp' && created.links.length === 0 && <p className="hint">There is no reachable network address yet. Join on this computer, then share a link after a VPN or LAN address appears.</p>}
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
                  {created.linkMode === 'temp'
                    ? 'Guests open a Cloudflare address, so their browser trusts Cloudflare rather than this computer. This computer’s meeting fingerprint is still '
                    : 'The first time someone opens this in a browser, they need to trust this computer’s certificate. The certificate fingerprint is '}
                  <span className="mono" data-testid="fingerprint">
                    {created.fingerprint}
                  </span>
                  .
                </p>
              )}
              {browserNote && <p className="hint" data-testid="browser-note">{browserNote}</p>}
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
                    {window.meetlocal?.openHostedMeeting ? 'Open in browser' : 'Enter meeting'}
                  </button>
                </div>
              </div>
            </div>
          )}
          {!created && view === 'join' && canHost && (
            <form
              className="panel"
              onSubmit={(event) => {
                event.preventDefault()
                joinExisting()
              }}
            >
              <button className="text-back" type="button" data-testid="home-back" onClick={() => setView('home')}>
                Back
              </button>
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
              <button className="btn primary wide" type="submit" data-testid="join-continue">
                Continue
              </button>
            </form>
          )}
          {!created && view === 'settings' && (
            <section className="panel" data-testid="settings-panel">
              <button className="text-back" type="button" data-testid="home-back" onClick={() => setView('home')}>
                Back
              </button>
              <h2>Settings</h2>
              <p className="hint">Saved with this app, and used when the meeting opens in your browser.</p>
              <SettingsFields prefs={prefs} onChange={updatePrefs} />
            </section>
          )}
      </main>
    </div>
  )
}

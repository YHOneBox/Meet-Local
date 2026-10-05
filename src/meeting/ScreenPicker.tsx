import { useEffect, useState } from 'react'
import type { DesktopSource } from '../global'

export async function captureScreen(source?: DesktopSource, withAudio = false, surface?: 'monitor' | 'window' | 'browser'): Promise<MediaStream> {
  if (source && window.meetlocal?.isDesktop) {
    if (withAudio && window.meetlocal.platform === 'win32') {
      await window.meetlocal.setCaptureIntent({ sourceId: source.id, audio: true })
      try {
        return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      } finally {
        await window.meetlocal.setCaptureIntent(null)
      }
    }
    const video = {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: source.id,
        maxFrameRate: 30,
      },
    }
    const audio = withAudio ? { mandatory: { chromeMediaSource: 'desktop' } } : false
    return navigator.mediaDevices.getUserMedia({
      audio,
      video,
    } as unknown as MediaStreamConstraints)
  }
  const video: MediaTrackConstraints = { frameRate: 30 }
  if (surface === 'browser') video.displaySurface = 'browser'
  return navigator.mediaDevices.getDisplayMedia({
    video,
    audio: withAudio,
  })
}

export function ScreenPicker({
  onShare,
  onClose,
}: {
  onShare: (stream: MediaStream) => void
  onClose: () => void
}) {
  const desktop = Boolean(window.meetlocal?.isDesktop)
  const [sources, setSources] = useState<DesktopSource[]>([])
  const [tab, setTab] = useState<'screen' | 'window' | 'browser'>('screen')
  const [selected, setSelected] = useState('')
  const [audio, setAudio] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!desktop) return
    let cancelled = false
    window.meetlocal
      ?.getDesktopSources()
      .then((list) => {
        if (cancelled) return
        setSources(list)
        const first = list.find((item) => item.kind === 'screen') || list[0]
        if (first) setSelected(first.id)
      })
      .catch(() => setError('MeetLocal could not list screens on this computer.'))
    return () => {
      cancelled = true
    }
  }, [desktop])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const visible = sources.filter((item) => item.kind === (tab === 'screen' ? 'screen' : 'window'))
  const chosen = sources.find((item) => item.id === selected)

  function showKind(next: 'screen' | 'window' | 'browser') {
    setTab(next)
    if (next === 'browser') setAudio(true)
    const first = sources.find((item) => item.kind === (next === 'screen' ? 'screen' : 'window'))
    if (first) setSelected(first.id)
  }

  async function share(surface?: 'monitor' | 'window' | 'browser') {
    const wantAudio = !desktop || surface === 'browser' || tab === 'browser' ? true : audio
    if (desktop && surface !== 'browser' && !chosen) return
    setBusy(true)
    setError('')
    try {
      const stream = await captureScreen(desktop && surface !== 'browser' ? chosen : undefined, wantAudio, surface)
      onShare(stream)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screen sharing was cancelled.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="share-dismiss" type="button" aria-label="Close sharing options" onClick={onClose} />
      <div className="share-pop" role="dialog" aria-modal="true" aria-labelledby="share-title" data-testid="screen-picker">
        <p className="kicker">Present</p>
        <h2 id="share-title">What do you want to share?</h2>
        {desktop ? (
          <>
            <div className="segmented three" role="tablist">
              <button type="button" className={tab === 'screen' ? 'active' : ''} onClick={() => showKind('screen')} data-testid="tab-screens">
                Screen
              </button>
              <button type="button" className={tab === 'window' ? 'active' : ''} onClick={() => showKind('window')} data-testid="tab-windows">
                Window
              </button>
              <button type="button" className={tab === 'browser' ? 'active' : ''} onClick={() => showKind('browser')} data-testid="tab-browser">
                Tab
              </button>
            </div>
            {tab === 'browser' && (
              <p className="hint">Pick the browser window that has the tab. Sound playing on this computer is shared, so the tab can be heard. Headphones keep the call from echoing.</p>
            )}
            <div className="source-grid">
              {visible.length === 0 && <p className="hint">Nothing is available on this tab.</p>}
              {visible.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className={source.id === selected ? 'source active' : 'source'}
                  onClick={() => setSelected(source.id)}
                  data-testid="share-source"
                  data-kind={source.kind}
                >
                  <img src={source.thumbnail} alt="" />
                  <span>{source.name || (source.kind === 'screen' ? 'Screen' : 'Window')}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="share-options">
            <button type="button" data-testid="share-choice-screen" disabled={busy} onClick={() => void share('monitor')}>
              <strong>Entire screen</strong>
              <span>Show everything on a display</span>
            </button>
            <button type="button" data-testid="share-choice-window" disabled={busy} onClick={() => void share('window')}>
              <strong>A window</strong>
              <span>Show one application window</span>
            </button>
            <button type="button" data-testid="share-choice-tab" disabled={busy} onClick={() => void share('browser')}>
              <strong>A browser tab</strong>
              <span>Show one tab and its sound</span>
            </button>
          </div>
        )}
        {desktop ? (
          <label className="check">
            <input type="checkbox" checked={audio || tab === 'browser'} onChange={(event) => setAudio(event.target.checked)} disabled={tab === 'browser'} />
            Share sound playing on this computer
          </label>
        ) : (
          <p className="hint">The browser then lets you pick a screen, window, or tab. Allow tab audio in that prompt so other people can hear the tab.</p>
        )}
        {error && <p className="error">{error}</p>}
        <footer className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          {desktop && (
            <button className="btn primary" type="button" disabled={!chosen || busy} onClick={() => void share()} data-testid="confirm-share">
              {busy ? 'Starting…' : 'Share'}
            </button>
          )}
        </footer>
      </div>
    </>
  )
}

import { useEffect, useState } from 'react'
import type { DesktopSource } from '../global'

export async function captureScreen(source?: DesktopSource, withAudio = false, surface?: 'monitor' | 'window' | 'browser'): Promise<MediaStream> {
  if (source && window.meetlocal?.isDesktop) {
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
  if (surface) video.displaySurface = surface
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
  const [tab, setTab] = useState<'screen' | 'window'>('screen')
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

  const visible = sources.filter((item) => item.kind === tab)
  const chosen = sources.find((item) => item.id === selected)

  async function share(surface?: 'monitor' | 'window' | 'browser') {
    if (desktop && !chosen) return
    setBusy(true)
    setError('')
    try {
      const stream = await captureScreen(desktop ? chosen : undefined, audio, surface)
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
            <div className="segmented" role="tablist">
              <button type="button" className={tab === 'screen' ? 'active' : ''} onClick={() => setTab('screen')} data-testid="tab-screens">
                Entire screen
              </button>
              <button type="button" className={tab === 'window' ? 'active' : ''} onClick={() => setTab('window')} data-testid="tab-windows">
                A window
              </button>
            </div>
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
              <span>Show one tab</span>
            </button>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={audio} onChange={(event) => setAudio(event.target.checked)} />
          Share system audio with the screen
        </label>
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

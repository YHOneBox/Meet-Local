import { useEffect, useState } from 'react'
import type { DesktopSource } from '../global'

export async function captureScreen(source?: DesktopSource, withAudio = false): Promise<MediaStream> {
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
  return navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
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
  const [sources, setSources] = useState<DesktopSource[]>([])
  const [tab, setTab] = useState<'screen' | 'window'>('screen')
  const [selected, setSelected] = useState('')
  const [audio, setAudio] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
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
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const visible = sources.filter((item) => item.kind === tab)
  const chosen = sources.find((item) => item.id === selected)

  async function share() {
    if (!chosen) return
    setBusy(true)
    setError('')
    try {
      const stream = await captureScreen(chosen, audio)
      onShare(stream)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screen sharing was cancelled.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-back" role="presentation">
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="share-title" data-testid="screen-picker">
        <header className="modal-head">
          <div>
            <p className="kicker">Present</p>
            <h2 id="share-title">Choose what to share</h2>
          </div>
          <button className="btn ghost" type="button" onClick={onClose}>
            Close
          </button>
        </header>
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
        <label className="check">
          <input type="checkbox" checked={audio} onChange={(event) => setAudio(event.target.checked)} />
          Share system audio with the screen
        </label>
        {error && <p className="error">{error}</p>}
        <footer className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" disabled={!chosen || busy} onClick={() => void share()} data-testid="confirm-share">
            {busy ? 'Starting…' : 'Share'}
          </button>
        </footer>
      </div>
    </div>
  )
}

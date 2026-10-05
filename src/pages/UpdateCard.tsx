import { useEffect, useState } from 'react'
import type { UpdateInfo } from '../global'
import { parseInline, parseReleaseNotes } from '../../shared/updates'

function formatWhen(value: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatSize(bytes: number) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Notes({ text }: { text: string }) {
  const blocks = parseReleaseNotes(text)
  if (!blocks.length) return <p className="hint">This release has no written notes.</p>
  return (
    <div className="notes" data-testid="changelog">
      {blocks.map((block, index) => {
        if (block.type === 'heading') return <h3 key={index}>{block.text}</h3>
        if (block.type === 'list') {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={index}>
            <Inline text={block.text} />
          </p>
        )
      })}
    </div>
  )
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, index) => {
        if (part.type === 'code') return <code key={index}>{part.text}</code>
        if (part.type === 'link') {
          return (
            <a key={index} href={part.href} target="_blank" rel="noreferrer">
              {part.text}
            </a>
          )
        }
        return <span key={index}>{part.text}</span>
      })}
    </>
  )
}

export function UpdateCard() {
  const desktop = window.meetlocal
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [notesFor, setNotesFor] = useState<'update' | 'current' | null>(null)
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null)
  const [downloaded, setDownloaded] = useState<{ fileName: string; version: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!desktop?.checkForUpdate) return
    let cancel = false
    desktop
      .checkForUpdate()
      .then((next) => {
        if (!cancel) setInfo(next)
      })
      .catch(() => {
        if (!cancel) setError('Could not check for updates.')
      })
    return () => {
      cancel = true
    }
  }, [desktop])

  useEffect(() => {
    if (!desktop?.onUpdateProgress) return
    return desktop.onUpdateProgress((next) => setProgress(next))
  }, [desktop])

  if (!desktop?.checkForUpdate) return null

  async function scan() {
    if (!desktop?.checkForUpdate) return
    setBusy(true)
    setError('')
    try {
      const next = await desktop.checkForUpdate()
      setInfo(next)
      setDismissed(false)
    } catch {
      setError('Could not check for updates.')
    } finally {
      setBusy(false)
    }
  }

  async function download() {
    setBusy(true)
    setError('')
    setProgress({ received: 0, total: info?.assetSize || 0 })
    try {
      const saved = await desktop!.downloadUpdate()
      setDownloaded({ fileName: saved.fileName, version: saved.version })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The download stopped.')
    } finally {
      setBusy(false)
    }
  }

  const version = info?.currentVersion || desktop.version
  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0
  const showingUpdate = notesFor === 'update'
  const noteText = showingUpdate ? info?.notes || '' : info?.currentNotes || ''
  const noteTitle = showingUpdate ? info?.name || `MeetLocal ${info?.latestVersion}` : info?.currentNotesName || `MeetLocal ${version}`
  const noteDate = showingUpdate ? info?.publishedAt || '' : ''

  return (
    <>
      {info?.updateAvailable && !downloaded && !dismissed && (
        <div className="banner-card update-card" data-testid="update-banner">
          <div>
            <strong>Update to {info.latestVersion}?</strong>
            <p>
              You are on {version}. The download keeps the version in the file name
              {info.assetName ? `: ${info.assetName}` : ''}.
            </p>
            {busy && (
              <div className="update-bar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: progress?.total ? `${percent}%` : '40%' }} />
              </div>
            )}
            {error && <p className="error">{error}</p>}
          </div>
          <div className="modal-actions">
            <button className="btn ghost" type="button" data-testid="update-notes" onClick={() => setNotesFor('update')}>
              See changes
            </button>
            <button className="btn ghost" type="button" data-testid="update-later" onClick={() => setDismissed(true)}>
              Not now
            </button>
            <button className="btn primary" type="button" data-testid="update-download" disabled={busy} onClick={() => void download()}>
              {busy ? (progress?.total ? `${percent}%` : 'Downloading…') : `Download${info.assetSize ? ` ${formatSize(info.assetSize)}` : ''}`}
            </button>
          </div>
        </div>
      )}
      {downloaded && (
        <div className="banner-card update-card" data-testid="update-ready">
          <div>
            <strong>{downloaded.fileName} is ready</strong>
            <p>Open it to start {downloaded.version}. This copy stays where it is.</p>
          </div>
          <div className="modal-actions">
            <button className="btn ghost" type="button" onClick={() => void desktop.revealUpdate()}>
              Show file
            </button>
            <button className="btn primary" type="button" data-testid="update-launch" onClick={() => void desktop.launchUpdate()}>
              Open {downloaded.version}
            </button>
          </div>
        </div>
      )}
      {(!info?.updateAvailable || dismissed) && !downloaded && (
        <div className="version-row">
          <span>Version {version}</span>
          {!info && !error && <span className="fine">Checking for updates…</span>}
          {info?.currentNotes && (
            <button type="button" data-testid="whats-new" onClick={() => setNotesFor('current')}>
              What’s new
            </button>
          )}
          {info?.message && <span className="fine" data-testid="update-status">{info.message}</span>}
          {error && <span className="fine">{error}</span>}
          <button type="button" data-testid="update-check" onClick={() => void scan()} disabled={busy}>
            {busy ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
      )}
      {notesFor && (
        <div className="modal-back" role="presentation" onClick={() => setNotesFor(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="changelog-title" onClick={(event) => event.stopPropagation()}>
            <p className="kicker">{showingUpdate ? 'New version' : 'This version'}</p>
            <h2 id="changelog-title">{noteTitle}</h2>
            {noteDate && <p className="hint">{formatWhen(noteDate)}</p>}
            <Notes text={noteText} />
            <div className="modal-actions">
              {showingUpdate && !downloaded && (
                <button className="btn primary" type="button" disabled={busy} onClick={() => void download()}>
                  {busy ? 'Downloading…' : 'Download'}
                </button>
              )}
              <button className="btn ghost" type="button" onClick={() => setNotesFor(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

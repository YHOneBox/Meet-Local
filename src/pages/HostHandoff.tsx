import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { saveHost, saveJoinTarget } from '../store'

export function HostHandoff() {
  const { ticket = '' } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    let cancel = false
    fetch('/api/tickets/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('This host link has expired. Open the meeting again from MeetLocal.')
        return response.json() as Promise<{
          meetingId: string
          tempToken: string
          hostSecret: string
          linkMode: 'network' | 'temp'
          enterPath: string
          title: string
          fingerprint: string
          shareUrl: string
        }>
      })
      .then((record) => {
        if (cancel) return
        saveHost({
          meetingId: record.meetingId,
          tempToken: record.tempToken,
          hostSecret: record.hostSecret,
          linkMode: record.linkMode,
          enterPath: record.enterPath,
          title: record.title,
          password: '',
          shareUrl: record.shareUrl,
          fingerprint: record.fingerprint,
        })
        saveJoinTarget({
          httpBase: window.location.origin,
          meetingId: record.linkMode === 'network' ? record.meetingId : undefined,
          tempToken: record.linkMode === 'temp' ? record.tempToken : undefined,
          title: record.title,
        })
        navigate(record.enterPath, { replace: true })
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message)
      })
    return () => {
      cancel = true
    }
  }, [navigate, ticket])

  return (
    <div className="shell narrow">
      <div className="panel">
        <h2>{error ? 'Could not open the meeting' : 'Opening the meeting…'}</h2>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}

import { useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { HostHandoff } from './pages/HostHandoff'
import { LobbyPage } from './pages/LobbyPage'
import { MeetingPage } from './pages/MeetingPage'

export function App() {
  return (
    <BrowserRouter>
      <Theme />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/h/:ticket" element={<HostHandoff />} />
        <Route path="/m/:meetingId" element={<LobbyPage />} />
        <Route path="/t/:token" element={<LobbyPage />} />
        <Route path="/join" element={<LobbyPage />} />
        <Route path="/room" element={<MeetingPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  )
}

function Theme() {
  const location = useLocation()
  useEffect(() => {
    document.documentElement.dataset.theme = location.pathname === '/room' ? 'room' : 'paper'
  }, [location.pathname])
  return null
}

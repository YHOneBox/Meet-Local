import { useEffect, useRef, useState } from 'react'

const PALETTE = ['#0f6e6b', '#a15c38', '#3d5a80', '#6b4c7a', '#2f6f4e', '#8a5a2a', '#3e5c4a']

export function colorFor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  const letters = parts.map((part) => part[0]?.toUpperCase() ?? '').join('')
  return letters || '?'
}

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span className={large ? 'avatar lg' : 'avatar'} style={{ background: colorFor(name) }} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

export function MediaView({
  stream,
  muted = false,
  mirror = false,
  speakerId = '',
  version = 0,
  recordLabel,
}: {
  stream: MediaStream | null
  muted?: boolean
  mirror?: boolean
  speakerId?: string
  version?: number
  recordLabel?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.srcObject = stream
    if (stream) void element.play().catch(() => undefined)
    const sink = element as HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }
    if (speakerId && sink.setSinkId) void sink.setSinkId(speakerId).catch(() => undefined)
  }, [stream, speakerId, version])
  return (
    <video
      ref={ref}
      className={mirror ? 'mirror' : undefined}
      autoPlay
      playsInline
      muted={muted}
      data-record-video={recordLabel ? 'true' : undefined}
      data-record-label={recordLabel}
    />
  )
}

export function useSpeaking(stream: MediaStream | null, enabled: boolean, version = 0): boolean {
  const [speaking, setSpeaking] = useState(false)
  useEffect(() => {
    if (!enabled || !stream || stream.getAudioTracks().length === 0) {
      setSpeaking(false)
      return
    }
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const data = new Uint8Array(analyser.fftSize)
    let last = false
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i += 1) {
        const value = (data[i] - 128) / 128
        sum += value * value
      }
      const now = Math.sqrt(sum / data.length) > 0.045
      if (now !== last) {
        last = now
        setSpeaking(now)
      }
    }, 160)
    return () => {
      window.clearInterval(timer)
      source.disconnect()
      void context.close()
    }
  }, [stream, enabled, version])
  return speaking
}

export function Icon({ name }: { name: string }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (name === 'mic') {
    return (
      <svg {...common}>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M6 11a6 6 0 0 0 12 0M12 17v4M8 21h8" />
      </svg>
    )
  }
  if (name === 'mic-off') {
    return (
      <svg {...common}>
        <path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 11V6a3 3 0 0 0-5.3-1.9M6 11a6 6 0 0 0 9.5 4.8M12 17v4M4 4l16 16" />
      </svg>
    )
  }
  if (name === 'cam') {
    return (
      <svg {...common}>
        <rect x="3" y="7" width="12" height="10" rx="2" />
        <path d="M15 10.5 21 7v10l-6-3.5z" />
      </svg>
    )
  }
  if (name === 'cam-off') {
    return (
      <svg {...common}>
        <path d="M3 8a2 2 0 0 1 2-2h7M15 10.5 21 7v10l-4-2.3M4 19h8a2 2 0 0 0 2-2v-1M4 4l16 16" />
      </svg>
    )
  }
  if (name === 'screen') {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    )
  }
  if (name === 'hand') {
    return (
      <svg {...common}>
        <path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11M11 10V5.5a1.5 1.5 0 0 1 3 0V11M14 10.5V7.5a1.5 1.5 0 0 1 3 0V13c0 4-2 7-6 7-3.2 0-5-2-5.5-4.5L5 13.5A1.5 1.5 0 0 1 8 13" />
      </svg>
    )
  }
  if (name === 'chat') {
    return (
      <svg {...common}>
        <path d="M5 16.5 3.8 20 8 18.2A8 8 0 1 0 5 16.5Z" />
      </svg>
    )
  }
  if (name === 'people') {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0M17 11a2.5 2.5 0 1 0-2-4M16.5 19a5 5 0 0 0-2-3.8" />
      </svg>
    )
  }
  if (name === 'more') {
    return (
      <svg {...common}>
        <circle cx="6" cy="12" r="1" fill="currentColor" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
        <circle cx="18" cy="12" r="1" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M10 7V5a2 2 0 0 1 2-2h7v18h-7a2 2 0 0 1-2-2v-2M15 12H3m0 0 3-3M3 12l3 3" />
    </svg>
  )
}

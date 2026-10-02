type DrawSource = {
  video: HTMLVideoElement
  label: string
}

export class MeetingRecorder {
  private chunks: Blob[] = []
  private recorder: MediaRecorder | null = null
  private canvas = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D
  private audio = new AudioContext()
  private dest = this.audio.createMediaStreamDestination()
  private sources: MediaStreamAudioSourceNode[] = []
  private frame = 0
  private videos: DrawSource[] = []

  constructor() {
    this.canvas.width = 1280
    this.canvas.height = 720
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Recording is not available in this browser.')
    this.ctx = ctx
  }

  setInputs(videos: DrawSource[], streams: MediaStream[]) {
    this.videos = videos
    for (const source of this.sources) source.disconnect()
    this.sources = []
    for (const stream of streams) {
      if (stream.getAudioTracks().length === 0) continue
      const source = this.audio.createMediaStreamSource(stream)
      source.connect(this.dest)
      this.sources.push(source)
    }
  }

  start() {
    if (this.audio.state === 'suspended') void this.audio.resume()
    const canvasStream = this.canvas.captureStream(24)
    const mixed = new MediaStream([...canvasStream.getVideoTracks(), ...this.dest.stream.getAudioTracks()])
    const preferred = 'video/webm;codecs=vp8,opus'
    const mimeType = MediaRecorder.isTypeSupported(preferred) ? preferred : 'video/webm'
    this.chunks = []
    this.recorder = new MediaRecorder(mixed, { mimeType, videoBitsPerSecond: 2_500_000 })
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    this.recorder.start(1000)
    const draw = () => {
      this.paint()
      this.frame = requestAnimationFrame(draw)
    }
    draw()
  }

  async stop(): Promise<Blob> {
    cancelAnimationFrame(this.frame)
    const recorder = this.recorder
    if (!recorder) throw new Error('Recording has not started.')
    if (recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true })
        recorder.stop()
      })
    }
    for (const source of this.sources) source.disconnect()
    this.sources = []
    void this.audio.close()
    return new Blob(this.chunks, { type: recorder.mimeType || 'video/webm' })
  }

  private paint() {
    const ctx = this.ctx
    ctx.fillStyle = '#101413'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    const items = this.videos.filter((item) => item.video.readyState >= 2)
    const count = Math.max(items.length, 1)
    const columns = count <= 1 ? 1 : count <= 4 ? 2 : 3
    const rows = Math.ceil(count / columns)
    const gap = 12
    const cellW = (this.canvas.width - gap * (columns + 1)) / columns
    const cellH = (this.canvas.height - gap * (rows + 1)) / rows
    items.forEach((item, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const x = gap + column * (cellW + gap)
      const y = gap + row * (cellH + gap)
      ctx.fillStyle = '#1c2321'
      ctx.fillRect(x, y, cellW, cellH)
      const video = item.video
      const scale = Math.max(cellW / video.videoWidth, cellH / video.videoHeight)
      const dw = video.videoWidth * scale
      const dh = video.videoHeight * scale
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, cellW, cellH)
      ctx.clip()
      ctx.drawImage(video, x + (cellW - dw) / 2, y + (cellH - dh) / 2, dw, dh)
      ctx.restore()
      ctx.fillStyle = 'rgba(16,20,19,0.72)'
      ctx.fillRect(x + 12, y + cellH - 40, Math.min(ctx.measureText(item.label).width + 24, cellW - 24), 28)
      ctx.fillStyle = '#f6f3ec'
      ctx.font = '600 16px Outfit, sans-serif'
      ctx.fillText(item.label, x + 24, y + cellH - 20)
    })
    if (items.length === 0) {
      ctx.fillStyle = '#f6f3ec'
      ctx.font = '600 28px Outfit, sans-serif'
      ctx.fillText('MeetLocal recording', 48, 80)
    }
  }
}

export async function saveRecording(blob: Blob, filename: string) {
  if (window.meetlocal) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    return window.meetlocal.saveFile(bytes, filename)
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
  return { canceled: false }
}

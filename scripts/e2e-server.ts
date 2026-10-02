import path from 'node:path'
import { startMeetServer } from '../electron/server'

const running = await startMeetServer({
  port: 47999,
  listenHost: '127.0.0.1',
  tls: false,
  publicBase: 'http://meet.example.test',
  staticDir: path.resolve('dist'),
  projectRoot: path.resolve('.'),
})

console.log(`MeetLocal e2e server http://127.0.0.1:${running.port}`)

async function shutdown() {
  await running.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

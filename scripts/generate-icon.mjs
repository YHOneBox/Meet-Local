import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const size = 512
const pixels = Buffer.alloc(size * size * 4)

function set(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return
  const i = (y * size + x) * 4
  const alpha = a / 255
  const prev = pixels[i + 3] / 255
  const out = alpha + prev * (1 - alpha)
  if (out === 0) return
  pixels[i] = Math.round((r * alpha + pixels[i] * prev * (1 - alpha)) / out)
  pixels[i + 1] = Math.round((g * alpha + pixels[i + 1] * prev * (1 - alpha)) / out)
  pixels[i + 2] = Math.round((b * alpha + pixels[i + 2] * prev * (1 - alpha)) / out)
  pixels[i + 3] = Math.round(out * 255)
}

function fillRoundRect(x, y, w, h, radius, color) {
  for (let yy = 0; yy < h; yy += 1) {
    for (let xx = 0; xx < w; xx += 1) {
      const dx = xx < radius ? radius - xx : xx > w - radius ? xx - (w - radius) : 0
      const dy = yy < radius ? radius - yy : yy > h - radius ? yy - (h - radius) : 0
      if (dx * dx + dy * dy > radius * radius) continue
      set(x + xx, y + yy, color[0], color[1], color[2], color[3] ?? 255)
    }
  }
}

function fillCircle(cx, cy, radius, color) {
  const r2 = radius * radius
  for (let y = Math.floor(cy - radius); y <= cy + radius; y += 1) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x += 1) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy <= r2) set(x, y, color[0], color[1], color[2], color[3] ?? 255)
    }
  }
}

fillRoundRect(0, 0, size, size, 112, [15, 110, 107, 255])
fillCircle(256, 246, 92, [244, 211, 154, 255])
fillRoundRect(148, 196, 216, 148, 36, [255, 252, 247, 255])
fillCircle(256, 270, 38, [15, 110, 107, 255])
fillCircle(256, 270, 18, [227, 155, 43, 255])
fillRoundRect(332, 214, 36, 52, 16, [255, 252, 247, 255])

function crc(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data])
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc(body), 8 + data.length)
  return out
}

const raw = Buffer.alloc((size * 4 + 1) * size)
for (let y = 0; y < size; y += 1) {
  raw[y * (size * 4 + 1)] = 0
  pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(size, 0)
ihdr.writeUInt32BE(size, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])

const dir = path.resolve('resources')
mkdirSync(dir, { recursive: true })
writeFileSync(path.join(dir, 'icon.png'), png)
console.log('Wrote resources/icon.png')

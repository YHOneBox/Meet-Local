export const RELEASE_OWNER = 'YHOneBox'
export const RELEASE_REPO = 'Meet-Local'

const CDN_HOSTS = new Set([
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
])

export type ReleaseAsset = {
  name: string
  url: string
  size: number
}

export type NoteBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }

export type InlinePart =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string }

export function parseVersion(value: string): [number, number, number] | null {
  const match = value.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return 0
  for (let index = 0; index < 3; index += 1) {
    if (a[index] === b[index]) continue
    return a[index] < b[index] ? -1 : 1
  }
  return 0
}

export function releaseAssetName(version: string, platform: string, arch: string): string | null {
  const clean = version.trim().replace(/^v/i, '')
  if (!parseVersion(clean)) return null
  if (platform === 'win32') return `MeetLocal-${clean}-windows-${arch === 'arm64' ? 'arm64' : 'x64'}.exe`
  if (platform === 'darwin') return `MeetLocal-${clean}-mac-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`
  if (platform === 'linux') return `MeetLocal-${clean}-linux-${arch === 'arm64' ? 'arm64' : 'x64'}.AppImage`
  return null
}

export function pickReleaseAsset(assets: ReleaseAsset[], version: string, platform: string, arch: string): ReleaseAsset | null {
  const expected = releaseAssetName(version, platform, arch)
  if (!expected) return null
  return assets.find((asset) => asset.name === expected && isReleaseAssetUrl(asset.url)) ?? null
}

export function isReleaseAssetUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith(`/${RELEASE_OWNER}/${RELEASE_REPO}/releases/download/`)
    )
  } catch {
    return false
  }
}

export function isAllowedDownloadHost(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'github.com' || CDN_HOSTS.has(url.hostname))
  } catch {
    return false
  }
}

export function releasesApi(kind: 'latest' | 'tag', tag = ''): string {
  const base = `https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases`
  if (kind === 'latest') return `${base}/latest`
  return `${base}/tags/${encodeURIComponent(tag)}`
}

export function parseReleaseNotes(markdown: string): NoteBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n')
  const blocks: NoteBlock[] = []
  let paragraph: string[] = []
  let list: string[] = []

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim()
    if (text) blocks.push({ type: 'paragraph', text })
    paragraph = []
  }
  const flushList = () => {
    if (list.length) blocks.push({ type: 'list', items: list })
    list = []
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }
    const heading = line.match(/^#{1,3}\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', text: heading[1].replace(/\s+#+$/, '') })
      continue
    }
    const item = line.match(/^(?:[-*+]|\d+\.)\s+(.+)$/)
    if (item) {
      flushParagraph()
      list.push(item[1])
      continue
    }
    flushList()
    paragraph.push(line)
  }
  flushParagraph()
  flushList()
  return blocks
}

export function parseInline(input: string): InlinePart[] {
  const parts: InlinePart[] = []
  const pattern = /`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  let cursor = 0
  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ type: 'text', text: input.slice(cursor, index) })
    if (match[1]) parts.push({ type: 'code', text: match[1] })
    else if (match[2] && match[3]) parts.push({ type: 'link', text: match[2], href: match[3] })
    cursor = index + match[0].length
  }
  if (cursor < input.length) parts.push({ type: 'text', text: input.slice(cursor) })
  return parts.length ? parts : [{ type: 'text', text: input }]
}

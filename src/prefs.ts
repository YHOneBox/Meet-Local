export type FontSize = 'small' | 'medium' | 'large'
export type RoomStyle = 'night' | 'paper' | 'contrast'
export type RoomLayout = 'gallery' | 'speaker' | 'sidebar'

export type Prefs = {
  micId: string
  camId: string
  speakerId: string
  mirror: boolean
  processing: boolean
  saveData: boolean
  fontSize: FontSize
  style: RoomStyle
  micOn: boolean
  camOn: boolean
  layout: RoomLayout
  waitingRoom: boolean
}

const KEY = 'meetlocal.prefs'

export const defaultPrefs: Prefs = {
  micId: '',
  camId: '',
  speakerId: '',
  mirror: true,
  processing: true,
  saveData: false,
  fontSize: 'small',
  style: 'night',
  micOn: true,
  camOn: true,
  layout: 'gallery',
  waitingRoom: false,
}

const fontSizes = new Set<FontSize>(['small', 'medium', 'large'])
const styles = new Set<RoomStyle>(['night', 'paper', 'contrast'])
const layouts = new Set<RoomLayout>(['gallery', 'speaker', 'sidebar'])

export function normalizePrefs(value: Partial<Prefs> | null | undefined): Prefs {
  const raw = value || {}
  return {
    ...defaultPrefs,
    ...raw,
    fontSize: fontSizes.has(raw.fontSize as FontSize) ? (raw.fontSize as FontSize) : defaultPrefs.fontSize,
    style: styles.has(raw.style as RoomStyle) ? (raw.style as RoomStyle) : defaultPrefs.style,
    layout: layouts.has(raw.layout as RoomLayout) ? (raw.layout as RoomLayout) : defaultPrefs.layout,
    mirror: raw.mirror !== false,
    processing: raw.processing !== false,
    saveData: raw.saveData === true,
    micOn: raw.micOn !== false,
    camOn: raw.camOn !== false,
    waitingRoom: raw.waitingRoom === true,
  }
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaultPrefs }
    return normalizePrefs(JSON.parse(raw) as Partial<Prefs>)
  } catch {
    return { ...defaultPrefs }
  }
}

export function savePrefs(prefs: Prefs) {
  localStorage.setItem(KEY, JSON.stringify(normalizePrefs(prefs)))
}

export function applyAppearance(prefs: Prefs) {
  document.documentElement.dataset.font = prefs.fontSize
  document.documentElement.dataset.style = prefs.style
}

export async function publishPrefs(prefs: Prefs) {
  const next = normalizePrefs(prefs)
  savePrefs(next)
  applyAppearance(next)
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  }).catch(() => undefined)
}

export async function hydratePrefs(): Promise<Prefs> {
  if (!localStorage.getItem(KEY)) {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const prefs = normalizePrefs((await response.json()) as Partial<Prefs>)
        savePrefs(prefs)
        applyAppearance(prefs)
        return prefs
      }
    } catch {
      /* the host settings are optional */
    }
  }
  const prefs = loadPrefs()
  applyAppearance(prefs)
  return prefs
}

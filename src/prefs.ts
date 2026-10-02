export type Prefs = {
  micId: string
  camId: string
  speakerId: string
  mirror: boolean
  processing: boolean
  saveData: boolean
}

const KEY = 'meetlocal.prefs'

const defaults: Prefs = {
  micId: '',
  camId: '',
  speakerId: '',
  mirror: true,
  processing: true,
  saveData: false,
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    return { ...defaults, ...(JSON.parse(raw) as Partial<Prefs>) }
  } catch {
    return { ...defaults }
  }
}

export function savePrefs(prefs: Prefs) {
  localStorage.setItem(KEY, JSON.stringify(prefs))
}

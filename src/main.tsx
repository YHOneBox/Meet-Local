import { createRoot } from 'react-dom/client'
import '@fontsource/outfit/latin-400.css'
import '@fontsource/outfit/latin-500.css'
import '@fontsource/outfit/latin-600.css'
import '@fontsource/outfit/latin-700.css'
import '@fontsource/fraunces/latin-600-italic.css'
import { App } from './App'
import { hydratePrefs } from './prefs'
import './styles.css'

if (window.meetlocal?.isDesktop) document.documentElement.dataset.host = 'app'

void hydratePrefs().finally(() => {
  createRoot(document.getElementById('root') as HTMLElement).render(<App />)
})

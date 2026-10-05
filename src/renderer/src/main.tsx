import { createRoot } from 'react-dom/client'
import './styles.css'
import './i18n'
import { App } from './App'

// A file dropped outside a drop zone would otherwise replace the app with the file.
for (const ev of ['dragover', 'drop']) window.addEventListener(ev, (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(<App />)

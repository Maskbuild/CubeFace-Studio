// Browser-only dev server for the renderer (no Electron APIs; storage falls back to IndexedDB).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  server: { port: 5199 }
})

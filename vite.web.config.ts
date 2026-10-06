// Browser-only dev server for the renderer (no Electron APIs; storage falls back to IndexedDB).
import { createReadStream } from 'node:fs'
import os from 'node:os'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Dev only: serve the Prism Launcher client jar (item icons) like the desktop app reads it. */
const mcJars = (): Plugin => ({
  name: 'nkw-mc-jars',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const m = /^\/__mc\/(1\.20\.1|1\.21\.1|1\.21\.4)$/.exec(req.url ?? '')
      if (!m) return next()
      const root = process.env.APPDATA ?? os.homedir() + '/.local/share'
      const file = `${root}/PrismLauncher/libraries/com/mojang/minecraft/${m[1]}/minecraft-${m[1]}-client.jar`
      const s = createReadStream(file)
      s.on('error', () => {
        res.statusCode = 404
        res.end()
      })
      s.on('open', () => {
        res.setHeader('Content-Type', 'application/java-archive')
        if (req.method === 'HEAD') return res.end()
        s.pipe(res)
      })
    })
  }
})

export default defineConfig({
  root: 'src/renderer',
  plugins: [react(), mcJars()],
  server: { port: 5199 }
})

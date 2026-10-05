import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(app.getPath('appData'), 'nkw-skin-figura')
const SKINS = path.join(ROOT, 'skins')
const GLOBAL = path.join(ROOT, 'global')
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/

function checkId(id: unknown): string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('invalid id')
  return id
}

const toDataUrl = (buf: Buffer) => 'data:image/png;base64,' + buf.toString('base64')
const fromDataUrl = (url: string) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

async function readPng(file: string): Promise<string | null> {
  try {
    return toDataUrl(await fs.readFile(file))
  } catch {
    return null
  }
}

function registerIpc() {
  ipcMain.handle('lib:list', async () => {
    await fs.mkdir(SKINS, { recursive: true })
    const out = []
    for (const id of await fs.readdir(SKINS)) {
      if (!ID_RE.test(id)) continue
      const project = await readJson<Record<string, unknown>>(path.join(SKINS, id, 'project.json'))
      if (!project) continue
      out.push({ project, thumb: await readPng(path.join(SKINS, id, 'thumb.png')) })
    }
    return out
  })

  ipcMain.handle('lib:load', async (_e, rawId) => {
    const dir = path.join(SKINS, checkId(rawId))
    const project = await readJson<{ layers: { id: string }[]; hair?: { id: string }[]; faceFrames?: string[] }>(path.join(dir, 'project.json'))
    if (!project) return null
    // hair-plane textures are stored next to the layer PNGs, keyed by their own ids
    const layers: Record<string, string> = {}
    const faces = (project.faceFrames ?? []).map((f) => ({ id: 'face_' + f }))
    for (const l of [...project.layers, ...(project.hair ?? []), ...faces]) {
      const png = await readPng(path.join(dir, 'layers', checkId(l.id) + '.png'))
      if (png) layers[l.id] = png
    }
    return { project, layers }
  })

  ipcMain.handle('lib:save', async (_e, { project, layers, thumb }) => {
    const dir = path.join(SKINS, checkId(project.id))
    const layerDir = path.join(dir, 'layers')
    await fs.mkdir(layerDir, { recursive: true })
    const keep = new Set<string>()
    for (const [id, url] of Object.entries(layers as Record<string, string>)) {
      keep.add(checkId(id) + '.png')
      await fs.writeFile(path.join(layerDir, id + '.png'), fromDataUrl(url))
    }
    for (const f of await fs.readdir(layerDir)) if (!keep.has(f)) await fs.rm(path.join(layerDir, f))
    if (thumb) await fs.writeFile(path.join(dir, 'thumb.png'), fromDataUrl(thumb))
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project, null, 2))
    return true
  })

  // Deleted skins go to the OS recycle bin so they can be restored.
  ipcMain.handle('lib:delete', async (_e, rawId) => {
    await shell.trashItem(path.join(SKINS, checkId(rawId)))
    return true
  })

  ipcMain.handle('global:get', async (_e, rawName) => readJson(path.join(GLOBAL, checkId(rawName) + '.json')))

  ipcMain.handle('global:set', async (_e, rawName, value) => {
    await fs.mkdir(GLOBAL, { recursive: true })
    await fs.writeFile(path.join(GLOBAL, checkId(rawName) + '.json'), JSON.stringify(value, null, 2))
    return true
  })

  // Global PNG assets shared by every skin (wardrobe items, …): global/<kind>/<id>.png
  const assetPath = (kind: unknown, id: unknown) => path.join(GLOBAL, checkId(kind), checkId(id) + '.png')
  ipcMain.handle('asset:get', async (_e, kind, id) => readPng(assetPath(kind, id)))
  ipcMain.handle('asset:set', async (_e, kind, id, dataUrl: string) => {
    const file = assetPath(kind, id)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, fromDataUrl(dataUrl))
    return true
  })
  ipcMain.handle('asset:delete', async (_e, kind, id) => {
    await fs.rm(assetPath(kind, id), { force: true })
    return true
  })

  // ---- Figura ------------------------------------------------------------------------
  /** Write a generated avatar into <chosen dir>/<folder>. Files are flat text (bbmodel/lua/json). */
  ipcMain.handle('figura:export', async (e, folder: string, files: Record<string, string>) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choose where to save the Figura avatar' })
    if (res.canceled || !res.filePaths[0]) return null
    const safe = folder.replace(/[^\w\- ]+/g, '').trim() || 'avatar'
    const dir = path.join(res.filePaths[0], safe)
    await fs.mkdir(dir, { recursive: true })
    for (const [name, text] of Object.entries(files)) {
      if (!/^[\w\-. ]+$/.test(name)) throw new Error('bad file name')
      await fs.writeFile(path.join(dir, name), text, 'utf8')
    }
    return dir
  })

  /** Merge several avatar folders into one; files with clashing names get a numeric suffix. */
  ipcMain.handle('figura:merge', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const src = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'multiSelections'], title: 'Choose the Figura avatar folders to merge' })
    if (src.canceled || src.filePaths.length < 2) return src.canceled ? null : { error: 'need2' }
    const dst = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choose an empty folder for the merged avatar' })
    if (dst.canceled || !dst.filePaths[0]) return null
    const out = dst.filePaths[0]
    const taken = new Set<string>()
    for (const f of await fs.readdir(out, { recursive: true })) taken.add(String(f).toLowerCase())
    const renamed: { from: string; to: string }[] = []
    let avatarJson: Record<string, unknown> | null = null
    const authors = new Set<string>()
    const walk = async (root: string, rel = ''): Promise<void> => {
      for (const ent of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
        const r = path.join(rel, ent.name)
        if (ent.isDirectory()) {
          await walk(root, r)
          continue
        }
        if (r.toLowerCase() === 'avatar.json') {
          const j = await readJson<Record<string, unknown>>(path.join(root, r))
          if (j) {
            avatarJson ??= j
            const a = j.authors ?? j.author
            for (const x of Array.isArray(a) ? a : a ? [a] : []) authors.add(String(x))
          }
          continue
        }
        let target = r
        const ext = path.extname(r)
        for (let n = 2; taken.has(target.toLowerCase()); n++) target = r.slice(0, r.length - ext.length) + '_' + n + ext
        if (target !== r) renamed.push({ from: path.join(path.basename(root), r), to: target })
        taken.add(target.toLowerCase())
        await fs.mkdir(path.dirname(path.join(out, target)), { recursive: true })
        await fs.copyFile(path.join(root, r), path.join(out, target))
      }
    }
    for (const dir of src.filePaths) await walk(dir)
    const merged = { ...(avatarJson ?? { name: 'Merged avatar' }), authors: [...authors] }
    delete (merged as Record<string, unknown>).author
    await fs.writeFile(path.join(out, 'avatar.json'), JSON.stringify(merged, null, 2))
    return { out, count: src.filePaths.length, renamed }
  })

  ipcMain.handle('dialog:openImage', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    const file = res.filePaths[0]
    const ext = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg')
    const buf = await fs.readFile(file)
    return { name: path.basename(file, path.extname(file)), dataUrl: `data:image/${ext};base64,` + buf.toString('base64') }
  })

  ipcMain.handle('dialog:savePng', async (e, dataUrl: string, defaultName: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      filters: [{ name: 'PNG', extensions: ['png'] }]
    })
    if (res.canceled || !res.filePath) return null
    await fs.writeFile(res.filePath, fromDataUrl(dataUrl))
    return res.filePath
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#111214',
    title: 'NKW Skin & Figura Custom',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win.show())
  // Keep the app offline: open external links in the system browser instead of in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())

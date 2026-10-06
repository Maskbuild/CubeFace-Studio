import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AvatarLibrary, mergeAvatars, type MergeSource } from './avatars'
import { checkVersion, downloadJar, findJar } from './minecraft'

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
  const avatars = new AvatarLibrary(path.join(GLOBAL, 'avatars'))
  // Minecraft client jars (read locally for item icons; downloaded from Mojang only on request)
  const MC_CACHE = path.join(ROOT, 'cache', 'minecraft')
  ipcMain.handle('mc:find', async (_e, v) => (await findJar(checkVersion(v), MC_CACHE))?.source ?? null)
  ipcMain.handle('mc:read', async (_e, v) => {
    const found = await findJar(checkVersion(v), MC_CACHE)
    return found ? new Uint8Array(await fs.readFile(found.file)) : null
  })
  ipcMain.handle('mc:download', async (_e, v) => new Uint8Array(await fs.readFile(await downloadJar(checkVersion(v), MC_CACHE))))
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
  ipcMain.handle('figura:export', async (e, folder: string, files: Record<string, string | Uint8Array>, attachIds: string[] = []) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choose where to save the Figura avatar' })
    if (res.canceled || !res.filePaths[0]) return null
    const safe = folder.replace(/[^\w\- ]+/g, '').trim() || 'avatar'
    const dir = path.join(res.filePaths[0], safe)
    await fs.mkdir(dir, { recursive: true })
    for (const [name, data] of Object.entries(files)) {
      // relative paths like "auria_wheel/core.lua"; never outside the avatar folder
      if (!/^[\w\-. ]+(\/[\w\-. ]+)*$/.test(name) || name.split('/').includes('..')) throw new Error('bad file name')
      const target = path.join(dir, ...name.split('/'))
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, typeof data === 'string' ? data : Buffer.from(data))
    }
    // avatars used with the skin are exported next to it, each in its own folder
    if (attachIds.length) await avatars.copyTo(attachIds, res.filePaths[0])
    return dir
  })

  // ---- avatar library (for merging) -----------------------------------------------------
  ipcMain.handle('avatars:list', () => avatars.list())
  /** Import folders (from a drop) or ask for them; returns what was added and what wasn't an avatar. */
  ipcMain.handle('avatars:import', async (e, paths?: string[]) => {
    if (!paths?.length) {
      const win = BrowserWindow.fromWebContents(e.sender)!
      const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'multiSelections'], title: 'Choose Figura avatar folders' })
      if (res.canceled) return { added: [], failed: [] }
      paths = res.filePaths
    }
    const added = []
    const failed: string[] = []
    for (const p of paths) {
      const m = await avatars.import(p)
      if (m) added.push(m)
      else failed.push(path.basename(p))
    }
    return { added, failed }
  })
  ipcMain.handle('avatars:files', (_e, id: string) => avatars.files(id))
  ipcMain.handle('avatars:read', (_e, id: string, rel: string) => avatars.read(id, String(rel)))
  ipcMain.handle('avatars:update', (_e, id: string, patch: { name?: string; category?: string; thumb3d?: string }) => {
    const clean: { name?: string; category?: string; thumb3d?: string } = {}
    if (typeof patch.name === 'string' && patch.name.trim()) clean.name = patch.name.trim()
    if (typeof patch.category === 'string') clean.category = patch.category
    if (typeof patch.thumb3d === 'string' && patch.thumb3d.startsWith('data:image/png;base64,') && patch.thumb3d.length < 600_000) clean.thumb3d = patch.thumb3d
    return avatars.update(id, clean)
  })
  ipcMain.handle('avatars:delete', async (_e, id: string) => {
    await shell.trashItem(avatars.libDir(id))
    return true
  })
  /** Merge library avatars (and optionally this skin's generated avatar) into a chosen folder. */
  ipcMain.handle('avatars:merge', async (e, ids: string[], current: { name: string; files: Record<string, string | Uint8Array> } | null, outName: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choose where to save the merged avatar' })
    if (res.canceled || !res.filePaths[0]) return null
    const metas = await avatars.list()
    const sources: MergeSource[] = []
    if (current) sources.push({ files: current.files, label: current.name })
    for (const id of ids) sources.push({ dir: avatars.filesDir(id), label: metas.find((m) => m.id === id)?.name ?? id })
    const safe = outName.replace(/[^\w\- ]+/g, '').trim() || 'Merged avatar'
    return mergeAvatars(path.join(res.filePaths[0], safe), sources)
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

  ipcMain.handle('dialog:saveFile', async (e, data: Uint8Array, defaultName: string, ext: string, label: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: label, extensions: [ext] }] })
    if (res.canceled || !res.filePath) return null
    await fs.writeFile(res.filePath, Buffer.from(data))
    return res.filePath
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

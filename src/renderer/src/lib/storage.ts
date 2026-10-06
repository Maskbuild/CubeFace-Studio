import type { ProjectJson } from '../skin/doc'

export interface AvatarMeta {
  id: string
  name: string
  authors: string[]
  description: string
  files: number
  bytes: number
  importedAt: number
  thumb: string | null
  thumb3d?: string
  category?: string
}

export interface MergeResult {
  out: string
  count: number
  renamed: { from: string; to: string }[]
}

export interface SkinEntry {
  project: ProjectJson
  thumb: string | null
}

export interface SavePayload {
  project: ProjectJson
  layers: Record<string, string> // layer id -> PNG data URL
  thumb: string | null
}

export interface Storage {
  listSkins(): Promise<SkinEntry[]>
  loadSkin(id: string): Promise<{ project: ProjectJson; layers: Record<string, string> } | null>
  saveSkin(p: SavePayload): Promise<boolean>
  deleteSkin(id: string): Promise<boolean>
  getGlobal<T>(name: string): Promise<T | null>
  setGlobal(name: string, value: unknown): Promise<boolean>
  getAsset(kind: string, id: string): Promise<string | null>
  setAsset(kind: string, id: string, dataUrl: string): Promise<boolean>
  deleteAsset(kind: string, id: string): Promise<boolean>
  exportFigura(folder: string, files: Record<string, string | Uint8Array>, attachIds?: string[]): Promise<string | null>
  listAvatars(): Promise<AvatarMeta[]>
  importAvatars(paths?: string[]): Promise<{ added: AvatarMeta[]; failed: string[] } | null>
  updateAvatar(id: string, patch: { name?: string; category?: string; thumb3d?: string }): Promise<void>
  avatarFiles(id: string): Promise<{ path: string; size: number }[]>
  readAvatarFile(id: string, rel: string): Promise<string | null>
  deleteAvatar(id: string): Promise<boolean>
  mergeAvatars(ids: string[], current: { name: string; files: Record<string, string | Uint8Array> } | null, outName: string): Promise<MergeResult | null>
  pathForFile?(file: File): string
  setZoom?(factor: number): void
  openImage(): Promise<{ name: string; dataUrl: string } | null>
  savePng(dataUrl: string, name: string): Promise<string | null>
  saveFile(data: Uint8Array, name: string, ext: string, label: string): Promise<string | null>
}

declare global {
  interface Window {
    nkw?: Storage
  }
}

// ---- Browser fallback (vite dev:web) — IndexedDB key/value ----------------------------------
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('nkw-skin-figura', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function kv<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction('kv', mode).objectStore('kv'))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

function pickFile(): Promise<{ name: string; dataUrl: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      const r = new FileReader()
      r.onload = () => resolve({ name: f.name.replace(/\.[^.]+$/, ''), dataUrl: r.result as string })
      r.readAsDataURL(f)
    }
    input.click()
  })
}

const webStorage: Storage = {
  async listSkins() {
    const keys = await kv<string[]>('readonly', (s) => s.getAllKeys())
    const out: SkinEntry[] = []
    for (const k of keys.filter((k) => String(k).startsWith('skin:'))) {
      const v = await kv<SavePayload>('readonly', (s) => s.get(k))
      out.push({ project: v.project, thumb: v.thumb })
    }
    return out
  },
  async loadSkin(id) {
    return (await kv<SavePayload | undefined>('readonly', (s) => s.get('skin:' + id))) ?? null
  },
  async saveSkin(p) {
    await kv('readwrite', (s) => s.put(p, 'skin:' + p.project.id))
    return true
  },
  async deleteSkin(id) {
    await kv('readwrite', (s) => s.delete('skin:' + id))
    return true
  },
  async getGlobal<T>(name: string) {
    return ((await kv<T | undefined>('readonly', (s) => s.get('global:' + name))) ?? null) as T | null
  },
  async setGlobal(name, value) {
    await kv('readwrite', (s) => s.put(value, 'global:' + name))
    return true
  },
  async getAsset(kind, id) {
    return (await kv<string | undefined>('readonly', (s) => s.get(`asset:${kind}:${id}`))) ?? null
  },
  async setAsset(kind, id, dataUrl) {
    await kv('readwrite', (s) => s.put(dataUrl, `asset:${kind}:${id}`))
    return true
  },
  async deleteAsset(kind, id) {
    await kv('readwrite', (s) => s.delete(`asset:${kind}:${id}`))
    return true
  },
  // the browser build has no folder access: offer each file as a download instead
  async exportFigura(folder, files) {
    for (const [name, data] of Object.entries(files)) {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([data as BlobPart]))
      a.download = folder + '_' + name
      a.click()
    }
    return folder
  },
  // avatar folders need the desktop app (no folder access in the browser build)
  async listAvatars() {
    return []
  },
  async importAvatars() {
    return null
  },
  async updateAvatar() {},
  async avatarFiles() {
    return []
  },
  async readAvatarFile() {
    return null
  },
  async deleteAvatar() {
    return false
  },
  async mergeAvatars() {
    return null
  },
  openImage: pickFile,
  async saveFile(data, name) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([data as BlobPart]))
    a.download = name
    a.click()
    return name
  },
  async savePng(dataUrl, name) {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = name
    a.click()
    return name
  }
}

export const storage: Storage = window.nkw ?? webStorage

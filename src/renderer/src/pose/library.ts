import { create } from 'zustand'
import { storage } from '../lib/storage'
import { loadImage } from '../lib/png'
import { parseEmoteFile, type Emote, type PoseState } from './emote'
import type { PosePreset } from './presets'

/*
 * Emotes and poses saved for every skin (global data, managed from the Home page and pose mode),
 * plus the playback clock the viewport publishes for the timeline.
 */

interface PoseLibrary {
  emotes: Emote[]
  poses: PosePreset[]
  loaded: boolean
  load(): Promise<void>
  addEmotes(list: Emote[]): void
  updateEmote(id: string, patch: Partial<Emote>): void
  removeEmote(id: string): void
  savePose(name: string, pose: PoseState): PosePreset
  removePose(id: string): void
}

let n = 0
export const usePoseLibrary = create<PoseLibrary>((set, get) => ({
  emotes: [],
  poses: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return
    const [emotes, poses] = await Promise.all([storage.getGlobal<Emote[]>('emotes'), storage.getGlobal<PosePreset[]>('poses')])
    set({ emotes: emotes ?? [], poses: poses ?? [], loaded: true })
  },
  addEmotes: (list) => {
    const emotes = [...get().emotes, ...list]
    set({ emotes })
    storage.setGlobal('emotes', emotes)
  },
  updateEmote: (id, patch) => {
    const emotes = get().emotes.map((e) => (e.id === id ? { ...e, ...patch } : e))
    set({ emotes })
    storage.setGlobal('emotes', emotes)
  },
  removeEmote: (id) => {
    const emotes = get().emotes.filter((e) => e.id !== id)
    set({ emotes })
    storage.setGlobal('emotes', emotes)
  },
  savePose: (name, pose) => {
    const p: PosePreset = { id: 'pose' + Date.now().toString(36) + (n++).toString(36), name, pose }
    const poses = [...get().poses, p]
    set({ poses })
    storage.setGlobal('poses', poses)
    return p
  },
  removePose: (id) => {
    const poses = get().poses.filter((p) => p.id !== id)
    set({ poses })
    storage.setGlobal('poses', poses)
  }
}))

/** Playback position published by the viewport (ticks) and seek requests from the timeline. */
export const usePoseClock = create<{ tick: number; seek: number | null }>(() => ({ tick: 0, seek: null }))

/**
 * Read emote files (Emotecraft .json / .emotecraft). A PNG with the same name next to a JSON
 * emote becomes its icon, like in Emotecraft's folder.
 */
export async function readEmoteFiles(files: File[]): Promise<{ emotes: Emote[]; failed: string[] }> {
  const emotes: Emote[] = []
  const failed: string[] = []
  const pngs = new Map(files.filter((f) => /\.png$/i.test(f.name)).map((f) => [f.name.replace(/\.png$/i, '').toLowerCase(), f]))
  for (const f of files) {
    if (!/\.(json|emotecraft)$/i.test(f.name)) continue
    try {
      const e = parseEmoteFile(new Uint8Array(await f.arrayBuffer()), f.name)
      const png = pngs.get(f.name.replace(/\.[^.]+$/, '').toLowerCase())
      if (png && !e.icon) e.icon = await new Promise<string>((res) => {
        const r = new FileReader()
        r.onload = () => res(r.result as string)
        r.readAsDataURL(png)
      })
      emotes.push(e)
    } catch (err) {
      failed.push(`${f.name}: ${(err as Error).message}`)
    }
  }
  return { emotes, failed }
}

/** Ask for emote files with the system file picker. */
export function pickEmoteFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = '.json,.emotecraft,.png'
    input.onchange = () => resolve([...(input.files ?? [])])
    input.click()
  })
}

/** A logo fitted into a 128px square (keeps the library small; pixel art stays crisp). */
export async function squareLogo(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl)
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const k = Math.min(S / img.width, S / img.height)
  g.imageSmoothingEnabled = k < 1
  const w = img.width * k, h = img.height * k
  g.drawImage(img, (S - w) / 2, (S - h) / 2, w, h)
  return c.toDataURL('image/png')
}


import { create } from 'zustand'
import type { SkinDoc } from '../skin/doc'
import type { RGBA } from '../skin/pixels'
import { toHex } from '../skin/color'
import { BUILTIN_PALETTES, type Palette } from '../skin/palette'
import { storage } from '../lib/storage'

export type Tool = 'brush' | 'eraser' | 'bucket' | 'picker' | 'orbit'
export type PaintTarget = 'auto' | 'base' | 'overlay'

interface BrushSettings {
  size: number
  softness: number
  shape: 'circle' | 'square'
  opacity: number
}

interface EditorStore {
  doc: SkinDoc | null
  tick: number // bumped on structural doc changes so React re-renders
  tool: Tool
  brush: BrushSettings
  eraser: BrushSettings
  fillMode: 'face' | 'element'
  grid: boolean
  mirror: boolean
  target: PaintTarget
  preview: boolean
  color: RGBA
  recent: string[]
  hidden: Record<string, boolean> // cuboid key -> hidden
  palettes: Palette[] // user palettes (global, shared by all skins)
  paletteId: string
  approvedNoMod: Set<string> // layer ids the user agreed to edit despite a no-modify license

  setDoc(doc: SkinDoc | null): void
  bump(): void
  set(p: Partial<EditorStore>): void
  setBrush(p: Partial<BrushSettings>): void
  pushRecent(c: RGBA): void
  toggleHidden(key: string): void
  loadPalettes(): Promise<void>
  savePalettes(list: Palette[]): void
}

export const useEditor = create<EditorStore>((set, get) => ({
  doc: null,
  tick: 0,
  tool: 'brush',
  brush: { size: 1, softness: 0, shape: 'square', opacity: 1 },
  eraser: { size: 2, softness: 0, shape: 'square', opacity: 1 },
  fillMode: 'face',
  grid: false,
  mirror: false,
  target: 'auto',
  preview: true,
  color: [64, 196, 200, 255],
  recent: [],
  hidden: {},
  palettes: [],
  paletteId: BUILTIN_PALETTES[0].id,
  approvedNoMod: new Set(),

  setDoc: (doc) => set({ doc, tick: get().tick + 1, approvedNoMod: new Set() }),
  bump: () => set({ tick: get().tick + 1 }),
  set: (p) => set(p),
  // brush/eraser keep separate settings; the active one depends on the current tool
  setBrush: (p) => (get().tool === 'eraser' ? set({ eraser: { ...get().eraser, ...p } }) : set({ brush: { ...get().brush, ...p } })),
  pushRecent: (c) => {
    const hex = toHex(c)
    const recent = [hex, ...get().recent.filter((h) => h !== hex)].slice(0, 24)
    set({ recent })
    storage.setGlobal('recentColors', recent)
  },
  toggleHidden: (key) => set({ hidden: { ...get().hidden, [key]: !get().hidden[key] } }),
  loadPalettes: async () => {
    const [palettes, recent, paletteId] = await Promise.all([
      storage.getGlobal<Palette[]>('palettes'),
      storage.getGlobal<string[]>('recentColors'),
      storage.getGlobal<string>('paletteId')
    ])
    set({ palettes: palettes ?? [], recent: recent ?? [], paletteId: paletteId ?? get().paletteId })
  },
  savePalettes: (list) => {
    set({ palettes: list })
    storage.setGlobal('palettes', list)
  }
}))

export const allPalettes = (custom: Palette[]) => [...BUILTIN_PALETTES, ...custom]

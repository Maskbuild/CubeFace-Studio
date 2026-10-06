import { create } from 'zustand'
import type { LayerMeta, SkinDoc } from '../skin/doc'
import type { Img } from '../skin/pixels'
import type { RGBA } from '../skin/pixels'
import { toHex } from '../skin/color'
import { BUILTIN_PALETTES, type Palette } from '../skin/palette'
import { storage } from '../lib/storage'
import type { MotionMode } from '../three/motion'
import type { ExprKey } from '../skin/figura'
import type { Bone, Emote, PoseState } from '../pose/emote'

export type Tool = 'brush' | 'eraser' | 'bucket' | 'gradient' | 'picker' | 'orbit'
export type PaintTarget = 'auto' | 'base' | 'overlay'

interface BrushSettings {
  size: number
  softness: number
  shape: 'circle' | 'square'
  opacity: number
  /** Stroke smoothing 0..1: the brush trails the pointer on a "rope" for steadier lines. */
  smooth: number
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
  /** Show Figura extras (hair planes + physics) in the viewport. */
  figura: boolean
  /** Workspace mode chosen with the top-right buttons. */
  mode: 'skin' | 'figura' | 'pose'
  /** Pose mode: the pose being edited, the selected part and the animation playing (not saved). */
  pose: PoseState
  poseBone: Bone | null
  emote: Emote | null
  emotePlaying: boolean
  emoteSpeed: number
  /** Pose-mode viewport hooks (set by the viewport). */
  poseShot: ((w: number, h: number) => string) | null
  /** Figura preview state (not saved). */
  figExpr: ExprKey | null
  figTalk: boolean
  motion: MotionMode
  hairOutlines: boolean
  color: RGBA
  /** Second colour (gradient end). */
  color2: RGBA
  /** Gradient bands (0 = smooth). */
  gradientSteps: number
  recent: string[]
  hidden: Record<string, boolean> // cuboid key -> hidden
  palettes: Palette[] // user palettes (global, shared by all skins)
  paletteId: string
  /** Copied layer (Ctrl+C) with its name and license info. */
  clipboard: { name: string; img: Img; meta: LayerMeta } | null
  /** Layer whose name field should open for editing (F2 / context menu). */
  renameLayerId: string | null
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
  brush: { size: 1, softness: 0, shape: 'square', opacity: 1, smooth: 0 },
  eraser: { size: 2, softness: 0, shape: 'square', opacity: 1, smooth: 0 },
  fillMode: 'face',
  grid: false,
  mirror: false,
  target: 'auto',
  preview: true,
  figura: true,
  mode: 'skin',
  pose: {},
  poseBone: null,
  emote: null,
  emotePlaying: false,
  emoteSpeed: 1,
  poseShot: null,
  figExpr: null,
  figTalk: false,
  motion: 'off',
  hairOutlines: true,
  color: [64, 196, 200, 255],
  color2: [255, 255, 255, 255],
  gradientSteps: 0,
  recent: [],
  hidden: {},
  palettes: [],
  paletteId: BUILTIN_PALETTES[0].id,
  approvedNoMod: new Set(),
  clipboard: null,
  renameLayerId: null,

  setDoc: (doc) => set({ doc, tick: get().tick + 1, approvedNoMod: new Set(), mode: 'skin', figExpr: null, figTalk: false, pose: {}, poseBone: null, emote: null, emotePlaying: false }),
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

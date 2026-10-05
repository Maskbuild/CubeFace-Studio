import { faceAt, faceRect, type Rect, type Variant } from './layout'
import { mirrorTexel } from './mirror'
import {
  brushKernel,
  clipRect,
  cloneImg,
  composite,
  createImg,
  fillRect,
  getPixel,
  readRect,
  resample,
  Stroke,
  unionRect,
  writeRect,
  type BrushOpts,
  type Img,
  type RGBA
} from './pixels'

export type License = 'free' | 'commercial-nomod' | 'commercial-mod' | 'exclusive'

export interface LayerMeta {
  credit: string
  license: License
  modifyPercent: number // only meaningful for 'commercial-mod'
  source?: string
}

export interface Layer {
  id: string
  name: string
  visible: boolean
  opacity: number
  locked: boolean
  meta: LayerMeta
  img: Img
}

export type LayerInfo = Omit<Layer, 'img'>

export interface ProjectJson {
  format: 1
  id: string
  name: string
  res: number
  variant: Variant
  createdAt: number
  updatedAt: number
  activeLayerId: string
  layers: LayerInfo[]
}

interface DocState {
  res: number
  variant: Variant
  activeId: string
  layers: Layer[]
}

type Entry =
  | { kind: 'pixels'; layerId: string; rect: Rect; before: Uint8ClampedArray; after: Uint8ClampedArray }
  | { kind: 'state'; before: DocState; after: DocState; tag?: string; time: number }

export type DocEvent = { type: 'pixels'; rect: Rect } | { type: 'structure' }

export const defaultMeta = (): LayerMeta => ({ credit: '', license: 'exclusive', modifyPercent: 100 })

/** True when the layer's license forbids editing (used to warn before painting). */
export const isNoModify = (m: LayerMeta) => m.license === 'commercial-nomod'

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

const HISTORY_LIMIT = 100

export class SkinDoc {
  id: string
  name: string
  res: number
  variant: Variant
  createdAt: number
  layers: Layer[] = []
  activeId = ''
  composite: Img
  version = 0
  savedVersion = 0
  private past: Entry[] = []
  private future: Entry[] = []
  private listeners = new Set<(e: DocEvent) => void>()

  constructor(opts: { id?: string; name: string; res: number; variant: Variant; createdAt?: number }) {
    this.id = opts.id ?? newId()
    this.name = opts.name
    this.res = opts.res
    this.variant = opts.variant
    this.createdAt = opts.createdAt ?? Date.now()
    this.composite = createImg(this.res, this.res)
  }

  // ---- events --------------------------------------------------------------------------
  on(fn: (e: DocEvent) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(e: DocEvent) {
    for (const fn of this.listeners) fn(e)
  }
  get dirty() {
    return this.version !== this.savedVersion
  }
  get canUndo() {
    return this.past.length > 0
  }
  get canRedo() {
    return this.future.length > 0
  }

  get active(): Layer | undefined {
    return this.layers.find((l) => l.id === this.activeId)
  }
  layer(id: string) {
    return this.layers.find((l) => l.id === id)
  }

  recomposite(rect?: Rect) {
    composite(this.layers, this.composite, rect)
    this.emit(rect ? { type: 'pixels', rect } : { type: 'structure' })
  }

  // ---- history -------------------------------------------------------------------------
  private push(e: Entry) {
    this.past.push(e)
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future = []
    this.version++
  }

  private state(): DocState {
    return { res: this.res, variant: this.variant, activeId: this.activeId, layers: this.layers.map((l) => ({ ...l, meta: { ...l.meta } })) }
  }

  private restore(s: DocState) {
    this.res = s.res
    this.variant = s.variant
    this.activeId = s.activeId
    this.layers = s.layers.map((l) => ({ ...l, meta: { ...l.meta } }))
    if (this.composite.w !== this.res) this.composite = createImg(this.res, this.res)
    this.recomposite()
  }

  /** Run a structural change and record it. Entries with the same tag within 800ms coalesce. */
  private change(fn: () => void, tag?: string) {
    const before = this.state()
    fn()
    const after = this.state()
    const last = this.past[this.past.length - 1]
    const now = Date.now()
    if (tag && last?.kind === 'state' && last.tag === tag && now - last.time < 800) {
      last.after = after
      last.time = now
      this.version++
    } else this.push({ kind: 'state', before, after, tag, time: now })
    this.recomposite()
  }

  undo() {
    const e = this.past.pop()
    if (!e) return
    this.future.push(e)
    this.version++
    this.applyEntry(e, 'before')
  }

  redo() {
    const e = this.future.pop()
    if (!e) return
    this.past.push(e)
    this.version++
    this.applyEntry(e, 'after')
  }

  private applyEntry(e: Entry, side: 'before' | 'after') {
    if (e.kind === 'state') return this.restore(e[side])
    const l = this.layer(e.layerId)
    if (!l) return
    writeRect(l.img, e.rect, e[side])
    this.recomposite(e.rect)
  }

  // ---- layers --------------------------------------------------------------------------
  /** Initial layers (no history). */
  initLayers(layers: Layer[], activeId?: string) {
    this.layers = layers
    this.activeId = activeId && layers.some((l) => l.id === activeId) ? activeId : layers[layers.length - 1]?.id ?? ''
    this.past = []
    this.future = []
    this.recomposite()
  }

  makeLayer(name: string, img?: Img, meta?: Partial<LayerMeta>): Layer {
    return {
      id: newId(),
      name,
      visible: true,
      opacity: 1,
      locked: false,
      meta: { ...defaultMeta(), ...meta },
      img: img ?? createImg(this.res, this.res)
    }
  }

  setActive(id: string) {
    if (this.layer(id)) {
      this.activeId = id
      this.emit({ type: 'structure' })
    }
  }

  addLayer(name: string, img?: Img, meta?: Partial<LayerMeta>): Layer {
    const layer = this.makeLayer(name, img, meta)
    this.change(() => {
      const idx = this.layers.findIndex((l) => l.id === this.activeId)
      this.layers.splice(idx + 1, 0, layer)
      this.activeId = layer.id
    })
    return layer
  }

  duplicateLayer(id: string) {
    const src = this.layer(id)
    if (!src) return
    const copy = { ...src, id: newId(), name: src.name + ' copy', meta: { ...src.meta }, img: cloneImg(src.img) }
    this.change(() => {
      this.layers.splice(this.layers.indexOf(this.layer(id)!) + 1, 0, copy)
      this.activeId = copy.id
    })
  }

  removeLayer(id: string) {
    if (this.layers.length <= 1) return
    this.change(() => {
      const idx = this.layers.findIndex((l) => l.id === id)
      this.layers.splice(idx, 1)
      if (this.activeId === id) this.activeId = this.layers[Math.max(0, idx - 1)].id
    })
  }

  /** dir +1 moves the layer up (towards the top of the stack). */
  moveLayer(id: string, dir: 1 | -1) {
    const idx = this.layers.findIndex((l) => l.id === id)
    const to = idx + dir
    if (idx < 0 || to < 0 || to >= this.layers.length) return
    this.change(() => {
      const [l] = this.layers.splice(idx, 1)
      this.layers.splice(to, 0, l)
    })
  }

  mergeDown(id: string) {
    const idx = this.layers.findIndex((l) => l.id === id)
    if (idx <= 0) return
    this.change(() => {
      const top = this.layers[idx]
      const below = this.layers[idx - 1]
      const merged = createImg(this.res, this.res)
      composite([{ img: below.img, visible: true, opacity: 1 }, top], merged)
      this.layers[idx - 1] = { ...below, img: merged }
      this.layers.splice(idx, 1)
      this.activeId = below.id
    })
  }

  setLayerProps(id: string, props: Partial<Omit<Layer, 'id' | 'img'>>) {
    this.change(() => {
      const l = this.layer(id)
      if (l) Object.assign(l, props)
    }, `props:${id}:${Object.keys(props).join(',')}`)
  }

  // ---- document-wide -------------------------------------------------------------------
  setResolution(res: number) {
    if (res === this.res) return
    this.change(() => {
      this.layers = this.layers.map((l) => ({ ...l, img: resample(l.img, res) }))
      this.res = res
      this.composite = createImg(res, res)
    })
  }

  setVariant(variant: Variant) {
    if (variant !== this.variant) this.change(() => (this.variant = variant))
  }

  rename(name: string) {
    this.name = name
    this.version++
    this.emit({ type: 'structure' })
  }

  // ---- painting ------------------------------------------------------------------------
  /** Returns null if the active layer can't be painted (missing, hidden or locked). */
  beginStroke(color: RGBA, opacity: number, mode: 'paint' | 'erase'): Stroke | null {
    const l = this.active
    if (!l || l.locked || !l.visible) return null
    return new Stroke(l.img, cloneImg(l.img), color, opacity, mode)
  }

  /** Stamp a brush at texel (cx, cy). `clip` limits painting to one face (3D painting). */
  stamp(stroke: Stroke, cx: number, cy: number, brush: BrushOpts, clip: Rect | null, mirror: boolean) {
    const k = brushKernel(brush)
    let a: Rect | null = null
    let b: Rect | null = null
    for (let y = 0; y < k.n; y++)
      for (let x = 0; x < k.n; x++) {
        const v = k.a[y * k.n + x]
        if (v <= 0) continue
        const px = cx + k.off + x
        const py = cy + k.off + y
        if (clip && (px < clip.x || py < clip.y || px >= clip.x + clip.w || py >= clip.y + clip.h)) continue
        if (!stroke.cover(px, py, v)) continue
        a = unionRect(a, { x: px, y: py, w: 1, h: 1 })
        if (mirror) {
          const m = mirrorTexel(this.variant, this.res, px, py)
          if (m && stroke.cover(m[0], m[1], v)) b = unionRect(b, { x: m[0], y: m[1], w: 1, h: 1 })
        }
      }
    for (const r of [a, b]) {
      if (!r) continue
      stroke.apply(r)
      composite(this.layers, this.composite, r)
      this.emit({ type: 'pixels', rect: r })
    }
  }

  /** Stamp along a line between two texels (inclusive of the end point). */
  strokeLine(stroke: Stroke, from: [number, number], to: [number, number], brush: BrushOpts, clip: Rect | null, mirror: boolean) {
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1])
    const step = Math.max(1, brush.size / 4)
    const n = Math.max(1, Math.ceil(dist / step))
    for (let i = 1; i <= n; i++) {
      const t = i / n
      this.stamp(stroke, Math.round(from[0] + (to[0] - from[0]) * t), Math.round(from[1] + (to[1] - from[1]) * t), brush, clip, mirror)
    }
  }

  endStroke(stroke: Stroke) {
    const r = stroke.dirty
    if (!r) return
    const id = this.layers.find((l) => l.img === stroke.target)?.id
    if (!id) return
    this.push({ kind: 'pixels', layerId: id, rect: r, before: readRect(stroke.snapshot, r), after: readRect(stroke.target, r) })
    this.emit({ type: 'structure' })
  }

  /** Paint-bucket: 'face' fills the face under the texel, 'element' fills every face of its cuboid. */
  fill(x: number, y: number, mode: 'face' | 'element', color: RGBA, opacity: number, erase: boolean, mirror: boolean) {
    const l = this.active
    if (!l || l.locked || !l.visible) return false
    const ref = faceAt(this.variant, this.res, x, y)
    if (!ref) return false
    const rects: Rect[] = mode === 'face' ? [faceRect(this.variant, this.res, ref)] : [0, 1, 2, 3, 4, 5].map((f) => faceRect(this.variant, this.res, { cuboid: ref.cuboid, face: f }))
    if (mirror) {
      for (const r of [...rects]) {
        const m = mirrorTexel(this.variant, this.res, r.x, r.y)
        const mref = m && faceAt(this.variant, this.res, m[0], m[1])
        if (mref) rects.push(faceRect(this.variant, this.res, mref))
      }
    }
    let bounds: Rect | null = null
    for (const r of rects) bounds = unionRect(bounds, r)
    const b = clipRect(bounds!, this.res, this.res)!
    const before = readRect(l.img, b)
    const seen = new Set<string>()
    for (const r of rects) {
      const key = `${r.x},${r.y}`
      if (seen.has(key)) continue
      seen.add(key)
      fillRect(l.img, r, color, opacity, erase)
    }
    this.push({ kind: 'pixels', layerId: l.id, rect: b, before, after: readRect(l.img, b) })
    this.recomposite(b)
    this.emit({ type: 'structure' })
    return true
  }

  pick(x: number, y: number): RGBA {
    return getPixel(this.composite, x, y)
  }

  // ---- serialization -------------------------------------------------------------------
  toJson(): ProjectJson {
    return {
      format: 1,
      id: this.id,
      name: this.name,
      res: this.res,
      variant: this.variant,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      activeLayerId: this.activeId,
      layers: this.layers.map(({ img: _img, ...info }) => info)
    }
  }

  markSaved() {
    this.savedVersion = this.version
    this.emit({ type: 'structure' })
  }
}

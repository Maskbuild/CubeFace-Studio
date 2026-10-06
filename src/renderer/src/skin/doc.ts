import { faceAt, faceRect, type Rect, type Variant } from './layout'
import { faceOrigin, figuraDefaults, generateFrames, scaleConfig, type FaceFrame, type FiguraConfig } from './figura'
import { hairDefaults, hairTexSize, rescale, type HairInfo, type HairLength, type HairPlane, type HairSide } from './hair'
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
  hair?: HairInfo[]
  figura?: FiguraConfig
  faceFrames?: FaceFrame[]
}

interface DocState {
  res: number
  variant: Variant
  activeId: string
  layers: Layer[]
  hair: HairPlane[]
  figura: FiguraConfig
  faces: Partial<Record<FaceFrame, Img>>
}

type Entry =
  | { kind: 'pixels'; targetId: string; rect: Rect; before: Uint8ClampedArray; after: Uint8ClampedArray }
  | { kind: 'state'; before: DocState; after: DocState; tag?: string; time: number }

export type DocEvent = { type: 'pixels'; rect: Rect } | { type: 'hair'; id: string } | { type: 'face'; frame: FaceFrame } | { type: 'structure' }

/** History/storage id for a face frame texture. */
export const faceId = (f: FaceFrame) => 'face_' + f

const cloneHair = (h: HairPlane): HairPlane => ({ ...h, pos: [...h.pos], rot: [...h.rot], phys: { ...h.phys } })

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
  hair: HairPlane[] = []
  /** Selected hair plane (for the properties panel); not part of history. */
  hairId: string | null = null
  figura: FiguraConfig
  /** Face overlay frames (expressions, blink, talk), each the size of the head's front face. */
  faces: Partial<Record<FaceFrame, Img>> = {}
  /** Face frame shown/painted in the UV panel; not part of history. */
  faceFrame: FaceFrame | null = null
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
    this.figura = figuraDefaults(this.res)
  }

  // ---- events --------------------------------------------------------------------------
  on(fn: (e: DocEvent) => void) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
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
    return { res: this.res, variant: this.variant, activeId: this.activeId, layers: this.layers.map((l) => ({ ...l, meta: { ...l.meta } })), hair: this.hair.map(cloneHair), figura: { ...this.figura }, faces: { ...this.faces } }
  }

  private restore(s: DocState) {
    this.res = s.res
    this.variant = s.variant
    this.activeId = s.activeId
    this.layers = s.layers.map((l) => ({ ...l, meta: { ...l.meta } }))
    this.hair = s.hair.map(cloneHair)
    this.figura = { ...s.figura }
    this.faces = { ...s.faces }
    if (this.hairId && !this.hair.some((h) => h.id === this.hairId)) this.hairId = null
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
    const face = this.faceById(e.targetId)
    if (face) {
      writeRect(face.img, e.rect, e[side])
      return this.emit({ type: 'face', frame: face.frame })
    }
    const h = this.hairPlane(e.targetId)
    if (h) {
      writeRect(h.img, e.rect, e[side])
      return this.emit({ type: 'hair', id: h.id })
    }
    const l = this.layer(e.targetId)
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

  /** Replace a layer's pixels (import into layer / clear), as one undo step. */
  replaceLayerPixels(id: string, img: Img | null) {
    const l = this.layer(id)
    if (!l) return
    const r = { x: 0, y: 0, w: this.res, h: this.res }
    const before = readRect(l.img, r)
    if (img) writeRect(l.img, r, img.data)
    else l.img.data.fill(0)
    this.push({ kind: 'pixels', targetId: id, rect: r, before, after: readRect(l.img, r) })
    this.recomposite()
  }

  /** Move a layer to a stack index (0 = bottom), e.g. from drag and drop. */
  moveLayerTo(id: string, index: number) {
    const from = this.layers.findIndex((l) => l.id === id)
    const to = Math.max(0, Math.min(this.layers.length - 1, index))
    if (from < 0 || from === to) return
    this.change(() => {
      const [l] = this.layers.splice(from, 1)
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
      this.hair = this.hair.map((h) => ({ ...cloneHair(h), img: rescale(h.img, ...hairTexSize(h.w, h.h, res)) }))
      const n = faceOrigin(res).size
      this.faces = Object.fromEntries(Object.entries(this.faces).map(([f, img]) => [f, rescale(img!, n, n)]))
      this.figura = scaleConfig(this.figura, this.res, res)
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

  // ---- hair planes ---------------------------------------------------------------------
  hairPlane(id: string | null) {
    return id ? this.hair.find((h) => h.id === id) : undefined
  }

  /** Initial hair planes (no history). */
  initHair(hair: HairPlane[]) {
    this.hair = hair
    this.emit({ type: 'structure' })
  }

  selectHair(id: string | null) {
    this.hairId = id
    if (id) this.faceFrame = null
    this.emit({ type: 'structure' })
  }

  addHair(side: HairSide, length: HairLength, name: string): HairPlane {
    const d = hairDefaults(side, length)
    const [tw, th] = hairTexSize(d.w, d.h, this.res)
    const h: HairPlane = { ...d, id: newId(), name, img: createImg(tw, th) }
    this.change(() => this.hair.push(h))
    this.hairId = h.id
    this.emit({ type: 'structure' })
    return h
  }

  duplicateHair(id: string) {
    const src = this.hairPlane(id)
    if (!src) return
    const copy: HairPlane = { ...cloneHair(src), id: newId(), name: src.name + ' copy', img: cloneImg(src.img) }
    copy.pos = [src.pos[0] + 1, src.pos[1], src.pos[2]]
    this.change(() => this.hair.push(copy))
    this.selectHair(copy.id)
  }

  removeHair(id: string) {
    this.change(() => (this.hair = this.hair.filter((h) => h.id !== id)))
    if (this.hairId === id) this.selectHair(null)
  }

  /** Update hair properties; resizing rescales its texture so existing paint is kept. */
  updateHair(id: string, props: Partial<Omit<HairPlane, 'id' | 'img'>>) {
    this.change(() => {
      const i = this.hair.findIndex((h) => h.id === id)
      if (i < 0) return
      const h = { ...this.hair[i], ...props }
      const [tw, th] = hairTexSize(h.w, h.h, this.res)
      if (tw !== h.img.w || th !== h.img.h) h.img = rescale(h.img, tw, th)
      this.hair[i] = h
    }, `hair:${id}:${Object.keys(props).join(',')}`)
  }

  /** Add a preset's planes (textures already decoded) tagged with the preset id. */
  applyPreset(presetId: string, planes: HairPlane[]) {
    this.change(() => {
      for (const p of planes) {
        const [tw, th] = hairTexSize(p.w, p.h, this.res)
        this.hair.push({ ...cloneHair(p), id: newId(), presetId, img: p.img.w === tw && p.img.h === th ? cloneImg(p.img) : rescale(p.img, tw, th) })
      }
    })
  }

  removePreset(presetId: string) {
    this.change(() => (this.hair = this.hair.filter((h) => h.presetId !== presetId)))
    if (this.hairId && !this.hairPlane(this.hairId)) this.selectHair(null)
  }

  beginHairStroke(id: string, color: RGBA, opacity: number, mode: 'paint' | 'erase'): Stroke | null {
    const h = this.hairPlane(id)
    if (!h || !h.visible) return null
    return new Stroke(h.img, cloneImg(h.img), color, opacity, mode)
  }

  /** Fill a whole hair plane (paint bucket on hair). */
  fillHair(id: string, color: RGBA, opacity: number) {
    const h = this.hairPlane(id)
    if (!h) return false
    const r = { x: 0, y: 0, w: h.img.w, h: h.img.h }
    const before = readRect(h.img, r)
    fillRect(h.img, r, color, opacity)
    this.push({ kind: 'pixels', targetId: h.id, rect: r, before, after: readRect(h.img, r) })
    this.emit({ type: 'hair', id: h.id })
    this.emit({ type: 'structure' })
    return true
  }

  // ---- figura ----------------------------------------------------------------------------
  private faceByImg(img: Img): FaceFrame | undefined {
    return (Object.keys(this.faces) as FaceFrame[]).find((f) => this.faces[f] === img)
  }

  private faceById(id: string) {
    const frame = (Object.keys(this.faces) as FaceFrame[]).find((f) => faceId(f) === id)
    return frame ? { frame, img: this.faces[frame]! } : undefined
  }

  /** Initial Figura data (no history). */
  initFigura(cfg: FiguraConfig | undefined, faces: Partial<Record<FaceFrame, Img>>) {
    if (cfg) this.figura = { ...figuraDefaults(this.res), ...cfg }
    this.faces = faces
    this.emit({ type: 'structure' })
  }

  updateFigura(props: Partial<FiguraConfig>) {
    this.change(() => (this.figura = { ...this.figura, ...props }), `figura:${Object.keys(props).join(',')}`)
  }

  /** The head's front face cut out of the composite (reference for face frames). */
  faceImage(): Img {
    const o = faceOrigin(this.res)
    const out = createImg(o.size, o.size)
    writeRect(out, { x: 0, y: 0, w: o.size, h: o.size }, readRect(this.composite, { x: o.x, y: o.y, w: o.size, h: o.size }))
    return out
  }

  /** (Re)generate default expression/blink/talk frames from the eye and mouth rects. */
  generateFaces(only?: FaceFrame[]) {
    const frames = generateFrames(this.faceImage(), this.figura)
    const n = faceOrigin(this.res).size
    this.change(() => {
      const next = { ...this.faces }
      for (const f of only ?? (Object.keys(frames) as FaceFrame[])) next[f] = frames[f] ?? createImg(n, n)
      this.faces = next
    })
  }

  /** Add a user-made expression (blank frame, ready to paint). */
  addCustomExpr(name: string, coversEyes = false) {
    const c = { id: newId().slice(0, 8).toLowerCase(), name, coversEyes }
    const n = faceOrigin(this.res).size
    this.change(() => {
      this.figura = { ...this.figura, customExpr: [...this.figura.customExpr, c] }
      this.faces = { ...this.faces, [`x_${c.id}`]: createImg(n, n) }
    })
    this.selectFace(`x_${c.id}`)
    return c
  }

  updateCustomExpr(id: string, patch: Partial<{ name: string; coversEyes: boolean }>) {
    this.updateFigura({ customExpr: this.figura.customExpr.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  }

  removeCustomExpr(id: string) {
    const key = `x_${id}` as FaceFrame
    this.change(() => {
      this.figura = { ...this.figura, customExpr: this.figura.customExpr.filter((c) => c.id !== id) }
      const next = { ...this.faces }
      delete next[key]
      this.faces = next
    })
    if (this.faceFrame === key) this.selectFace(null)
  }

  /** Start an empty frame to draw by hand. */
  createBlankFace(f: FaceFrame) {
    const n = faceOrigin(this.res).size
    this.change(() => (this.faces = { ...this.faces, [f]: createImg(n, n) }))
    this.selectFace(f)
  }

  removeFace(f: FaceFrame) {
    this.change(() => {
      const next = { ...this.faces }
      delete next[f]
      this.faces = next
    })
    if (this.faceFrame === f) this.selectFace(null)
  }

  clearFace(f: FaceFrame) {
    const img = this.faces[f]
    if (!img) return
    const r = { x: 0, y: 0, w: img.w, h: img.h }
    const before = readRect(img, r)
    img.data.fill(0)
    this.push({ kind: 'pixels', targetId: faceId(f), rect: r, before, after: readRect(img, r) })
    this.emit({ type: 'face', frame: f })
    this.emit({ type: 'structure' })
  }

  selectFace(f: FaceFrame | null) {
    this.faceFrame = f
    if (f) this.hairId = null
    this.emit({ type: 'structure' })
  }

  beginFaceStroke(f: FaceFrame, color: RGBA, opacity: number, mode: 'paint' | 'erase'): Stroke | null {
    const img = this.faces[f]
    return img ? new Stroke(img, cloneImg(img), color, opacity, mode) : null
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
        if (mirror && this.faceByImg(stroke.target)) {
          const mx = stroke.target.w - 1 - px
          if (stroke.cover(mx, py, v)) a = unionRect(a, { x: mx, y: py, w: 1, h: 1 })
        } else if (mirror && stroke.target.w === this.res && stroke.target.h === this.res && this.layers.some((l) => l.img === stroke.target)) {
          const m = mirrorTexel(this.variant, this.res, px, py)
          if (m && stroke.cover(m[0], m[1], v)) b = unionRect(b, { x: m[0], y: m[1], w: 1, h: 1 })
        }
      }
    const hair = this.hair.find((h) => h.img === stroke.target)
    if (hair) {
      if (a) stroke.apply(a)
      return this.emit({ type: 'hair', id: hair.id })
    }
    const face = this.faceByImg(stroke.target)
    if (face) {
      if (a) stroke.apply(a)
      return this.emit({ type: 'face', frame: face })
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
    const f = this.faceByImg(stroke.target)
    const id = this.layers.find((l) => l.img === stroke.target)?.id ?? this.hair.find((h) => h.img === stroke.target)?.id ?? (f && faceId(f))
    if (!id) return
    this.push({ kind: 'pixels', targetId: id, rect: r, before: readRect(stroke.snapshot, r), after: readRect(stroke.target, r) })
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
    this.push({ kind: 'pixels', targetId: l.id, rect: b, before, after: readRect(l.img, b) })
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
      layers: this.layers.map(({ img: _img, ...info }) => info),
      hair: this.hair.map(({ img: _img, ...info }) => info),
      figura: this.figura,
      faceFrames: Object.keys(this.faces) as FaceFrame[]
    }
  }

  markSaved() {
    this.savedVersion = this.version
    this.emit({ type: 'structure' })
  }
}

import type { Rect } from './layout'
import { createImg, fillRect, getPixel, type Img, type RGBA } from './pixels'

export const EXPRESSIONS = ['angry', 'happy', 'shy', 'interested', 'surprised', 'crying', 'sad'] as const
export type Expression = (typeof EXPRESSIONS)[number]
/** A user-made expression; its frame key is "x_<id>". */
export interface CustomExpr {
  id: string
  name: string // English, shown on the action wheel
  coversEyes: boolean
}
export type CustomFrame = `x_${string}`
/** Face overlay frames: expressions plus the blink and talking frames. */
export type FaceFrame = Expression | 'blink' | 'talk' | CustomFrame
/** Any expression shown on the action wheel (built-in or custom). */
export type ExprKey = Expression | CustomFrame
export const FACE_FRAMES: FaceFrame[] = ['blink', 'talk', ...EXPRESSIONS]

export type EarType = 'none' | 'cat' | 'fox' | 'bunny' | 'wolf'
export type TailType = 'none' | 'cat' | 'fox' | 'bunny' | 'wolf'

/**
 * Figura features for one skin. Face rects are in texels of the head's front face
 * (a k*8 square where k = res/64), origin at its top-left.
 */
export interface FiguraConfig {
  smoothHead: boolean
  headSpeed: number // 0.05 (lazy) .. 1 (instant)
  hairPhysics: boolean
  swingAxis: 1 | -1 // flip if exported hair swings the wrong way in game
  blink: boolean
  blinkMin: number // seconds between blinks
  blinkMax: number
  smoothEyes: boolean
  eyeShift: number // max iris shift in texels
  eyeR: Rect // player's right eye (appears on the left of the face)
  eyeL: Rect
  browR: Rect
  browL: Rect
  mouth: Rect
  /** Hide only the vanilla parts this avatar replaces (so it can be merged), or the whole player. */
  hideVanilla: 'used' | 'all'
  expressions: boolean
  talk: boolean // mouth moves while speaking (Plasmo Voice via FigExtra)
  talkThreshold: number
  ears: EarType
  tail: TailType
  furColor: string
  furInner: string
  extrasPhysics: boolean
  customExpr: CustomExpr[]
  avatarName: string // export metadata, English only
  author: string
  description: string
}

/** Exported names/descriptions are English-only: keep printable ASCII. */
export const toEnglish = (s: string) => s.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim()

export function figuraDefaults(res: number): FiguraConfig {
  const k = res / 64
  // classic skin layout: 1-pixel eyes on row 4 (1-based) of the face, mouth on row 7
  return {
    smoothHead: true,
    headSpeed: 0.35,
    hairPhysics: true,
    swingAxis: 1,
    blink: true,
    blinkMin: 2.5,
    blinkMax: 6,
    smoothEyes: false,
    eyeShift: Math.max(1, Math.round(k / 2)),
    eyeR: { x: 1 * k, y: 4 * k, w: 2 * k, h: 1 * k },
    eyeL: { x: 5 * k, y: 4 * k, w: 2 * k, h: 1 * k },
    browR: { x: 1 * k, y: 3 * k, w: 2 * k, h: Math.max(1, k / 2) },
    browL: { x: 5 * k, y: 3 * k, w: 2 * k, h: Math.max(1, k / 2) },
    mouth: { x: 3 * k, y: 6 * k, w: 2 * k, h: 1 * k },
    hideVanilla: 'used',
    expressions: true,
    talk: true,
    talkThreshold: 0.05,
    ears: 'none',
    tail: 'none',
    furColor: '#6b4a33',
    furInner: '#f2b8c6',
    extrasPhysics: true,
    customExpr: [],
    avatarName: '',
    author: '',
    description: ''
  }
}

export function scaleConfig(c: FiguraConfig, from: number, to: number): FiguraConfig {
  const f = to / from
  const r = (x: Rect): Rect => ({ x: Math.round(x.x * f), y: Math.round(x.y * f), w: Math.max(1, Math.round(x.w * f)), h: Math.max(1, Math.round(x.h * f)) })
  return { ...c, eyeR: r(c.eyeR), eyeL: r(c.eyeL), browR: r(c.browR), browL: r(c.browL), mouth: r(c.mouth), eyeShift: Math.max(1, Math.round(c.eyeShift * f)) }
}

/** Head front face in skin texels. */
export const faceOrigin = (res: number) => ({ x: (8 * res) / 64, y: (8 * res) / 64, size: (8 * res) / 64 })

// ---- feature masks -----------------------------------------------------------------------

/** Pixel-precise selections inside the feature boxes: the iris (moves with smooth eyes) and brows. */
export type MaskKey = 'eyeR' | 'eyeL' | 'browR' | 'browL'
export const MASK_KEYS: MaskKey[] = ['eyeR', 'eyeL', 'browR', 'browL']
export type Masks = Partial<Record<MaskKey, Img>>

const lum = (c: RGBA) => (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255
const sat = (c: RGBA) => {
  const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2])
  return mx ? (mx - mn) / mx : 0
}
const dist = (a: RGBA, b: RGBA) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
const masked = (m: Img | undefined, x: number, y: number) => !!m && m.data[(y * m.w + x) * 4 + 3] > 127
export const hasAny = (m: Img | undefined) => !!m && m.data.some((v, i) => i % 4 === 3 && v > 127)

function eachIn(r: Rect, n: number, fn: (x: number, y: number) => void) {
  for (let y = Math.max(0, r.y); y < Math.min(n, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(n, r.x + r.w); x++) fn(x, y)
}

/** Most common opaque colour in a region (quantised), e.g. the skin tone around the eyes. */
function modeColor(face: Img, r: Rect, skip?: (x: number, y: number) => boolean): RGBA | null {
  const counts = new Map<number, { n: number; c: RGBA }>()
  eachIn(r, face.w, (x, y) => {
    if (skip?.(x, y)) return
    const p = getPixel(face, x, y)
    if (p[3] < 200) return
    const key = ((p[0] >> 3) << 10) | ((p[1] >> 3) << 5) | (p[2] >> 3)
    const e = counts.get(key)
    if (e) e.n++
    else counts.set(key, { n: 1, c: p })
  })
  let best: { n: number; c: RGBA } | null = null
  for (const e of counts.values()) if (!best || e.n > best.n) best = e
  return best ? [best.c[0], best.c[1], best.c[2], 255] : null
}

/** Colours sampled from the face: skin (cheeks below the eyes), darkest eye pixel, sclera. */
export function sampleFace(face: Img, c: FiguraConfig, masks: Masks = {}) {
  const n = face.w
  const eyeBottom = Math.max(c.eyeR.y + c.eyeR.h, c.eyeL.y + c.eyeL.h)
  const left = Math.min(c.eyeR.x, c.eyeL.x)
  const right = Math.max(c.eyeR.x + c.eyeR.w, c.eyeL.x + c.eyeL.w)
  const below = { x: left, y: eyeBottom, w: Math.max(1, right - left), h: Math.max(1, c.mouth.y - eyeBottom) }
  const skin = modeColor(face, below) ?? modeColor(face, { x: 0, y: 0, w: n, h: n }) ?? ([230, 190, 160, 255] as RGBA)
  let dark: RGBA = [30, 30, 40, 255]
  let lo = Infinity
  for (const r of [c.eyeR, c.eyeL])
    eachIn(r, n, (x, y) => {
      const p = getPixel(face, x, y)
      if (p[3] > 127 && lum(p) < lo) (lo = lum(p)), (dark = p)
    })
  // sclera: the most common light colour in the eye boxes outside the iris selection
  const light =
    modeColor(face, c.eyeR, (x, y) => masked(masks.eyeR, x, y) || lum(getPixel(face, x, y)) < 0.6) ??
    modeColor(face, c.eyeL, (x, y) => masked(masks.eyeL, x, y) || lum(getPixel(face, x, y)) < 0.6) ??
    ([250, 250, 250, 255] as RGBA)
  return { skin, dark, light }
}

/**
 * Guess a feature's pixels inside its box: for eyes the iris/pupil (coloured pixels plus dark
 * pupils next to them), for brows everything clearly darker than the skin tone.
 */
export function autoMask(face: Img, c: FiguraConfig, key: MaskKey): Img {
  const n = face.w
  const out = createImg(n, n)
  const { skin } = sampleFace(face, c)
  const r = c[key]
  const set = (x: number, y: number) => out.data.set([255, 255, 255, 255], (y * n + x) * 4)
  if (key === 'browR' || key === 'browL') {
    eachIn(r, n, (x, y) => {
      const p = getPixel(face, x, y)
      if (p[3] > 127 && dist(p, skin) > 90 && lum(p) < lum(skin)) set(x, y)
    })
    return out
  }
  const isIris = (p: RGBA) => p[3] > 127 && sat(p) > 0.22 && lum(p) < 0.92 && dist(p, skin) > 60
  eachIn(r, n, (x, y) => {
    if (isIris(getPixel(face, x, y))) set(x, y)
  })
  eachIn(r, n, (x, y) => {
    const p = getPixel(face, x, y)
    if (p[3] < 128 || lum(p) > 0.35 || masked(out, x, y)) return
    const side = [-1, 1].some((d) => masked(out, Math.min(n - 1, Math.max(0, x + d)), y))
    const vert = [-1, 1].some((d) => masked(out, x, Math.min(n - 1, Math.max(0, y + d))))
    if (side && vert) set(x, y)
  })
  // grey/black eyes (classic skins): fall back to the dark pixels in the box
  if (!hasAny(out))
    eachIn(r, n, (x, y) => {
      const p = getPixel(face, x, y)
      if (p[3] > 127 && lum(p) < 0.5 && dist(p, skin) > 60) set(x, y)
    })
  return out
}

/** Does this frame hide the open eyes (so iris planes must be hidden while it shows)? */
export const coversEyes = (f: FaceFrame, cfg?: FiguraConfig) =>
  f === 'blink' || f === 'happy' || f === 'crying' || (f.startsWith('x_') && !!cfg?.customExpr.find((c) => 'x_' + c.id === f)?.coversEyes)

export const customKey = (c: CustomExpr): CustomFrame => `x_${c.id}`
/** Built-in expressions followed by custom ones, in action-wheel order. */
export const exprKeys = (cfg: FiguraConfig): ExprKey[] => [...EXPRESSIONS, ...cfg.customExpr.map(customKey)]
/** All face frames for a config (blink, talk, built-ins, custom). */
export const allFrames = (cfg: FiguraConfig): FaceFrame[] => [...FACE_FRAMES, ...cfg.customExpr.map(customKey)]

// ---- procedural default frames ----------------------------------------------------------

/**
 * Generate pixel-art defaults for every face frame. Eye boxes are covered with skin for
 * closed-eye frames; eyebrows are moved using their real pixels (mask, or box when unmasked).
 * Frames are face-sized overlays (transparent where nothing changes) and can be repainted.
 */
export function generateFrames(face: Img, c: FiguraConfig, masks: Masks = {}): Record<FaceFrame, Img> {
  const n = face.w
  const k = Math.max(1, n / 8)
  const { skin, dark } = sampleFace(face, c, masks)
  const t = Math.max(1, Math.round(k / 4)) // line thickness (1 px on 64x skins, thicker on HD)
  const make = () => createImg(n, n)
  const put = (img: Img, x: number, y: number, col: RGBA, a = 1) => {
    x = Math.round(x)
    y = Math.round(y)
    if (x >= 0 && y >= 0 && x < n && y < n) fillRect(img, { x, y, w: 1, h: 1 }, col, a)
  }
  const block = (img: Img, x: number, y: number, w: number, h: number, col: RGBA, a = 1) => {
    for (let yy = 0; yy < Math.max(1, Math.round(h)); yy++) for (let xx = 0; xx < Math.max(1, Math.round(w)); xx++) put(img, x + xx, y + yy, col, a)
  }
  const eyes = [c.eyeR, c.eyeL]
  const cover = (img: Img, r: Rect) => eachIn(r, n, (x, y) => put(img, x, y, skin))
  /** A curve across a box: bend > 0 dips in the middle (closed eye), < 0 arches up (^). */
  const curve = (img: Img, r: Rect, yFrac: number, bend: number) => {
    const cx = r.x + (r.w - 1) / 2
    const hw = Math.max(1, r.w / 2)
    for (let x = r.x; x < r.x + r.w; x++) {
      const u = (x - cx) / hw
      const y = r.y + r.h * yFrac + bend * (1 - u * u) * Math.max(1, r.h * 0.35)
      block(img, x, y, 1, t, dark)
    }
  }
  /** Redraw a brow tilted (inner end down = angry, up = sad) or lifted. */
  const brow = (img: Img, key: 'browR' | 'browL', mode: 'angry' | 'sad' | 'up') => {
    const r = c[key]
    const m = masks[key]
    const useMask = hasAny(m)
    const px: { x: number; y: number; p: RGBA }[] = []
    eachIn(r, n, (x, y) => {
      const p = getPixel(face, x, y)
      if (useMask ? masked(m, x, y) : p[3] > 127 && dist(p, skin) > 90 && lum(p) < lum(skin)) px.push({ x, y, p })
    })
    if (!px.length) {
      // nothing painted there yet: draw a simple brow line
      for (let x = r.x; x < r.x + r.w; x++) px.push({ x, y: r.y + Math.floor(r.h / 2), p: dark })
    } else for (const q of px) put(img, q.x, q.y, skin) // erase the original brow
    // the right eye is on the viewer's left, so its inner end is at the right of its box
    const innerRight = key === 'browR'
    const lift = Math.max(t, Math.round(r.h / 3))
    for (const q of px) {
      const u = innerRight ? (q.x - r.x) / Math.max(1, r.w - 1) : 1 - (q.x - r.x) / Math.max(1, r.w - 1)
      const dy = mode === 'up' ? -lift : Math.round((mode === 'angry' ? 1 : -1) * u * lift)
      put(img, q.x, q.y + dy, q.p)
    }
  }
  const m = c.mouth
  const mouthDark: RGBA = [80, 30, 36, 255]
  const frames = {} as Record<FaceFrame, Img>

  frames.blink = make()
  eyes.forEach((e) => {
    cover(frames.blink, e)
    curve(frames.blink, e, 0.55, 0.6)
  })

  frames.talk = make()
  block(frames.talk, m.x, m.y, m.w, Math.max(m.h, 2 * t), mouthDark)

  frames.happy = make()
  eyes.forEach((e) => {
    cover(frames.happy, e)
    curve(frames.happy, e, 0.6, -1)
  })
  curve(frames.happy, { ...m, h: Math.max(m.h, 2 * t) }, 0.2, 1)

  frames.angry = make()
  brow(frames.angry, 'browR', 'angry')
  brow(frames.angry, 'browL', 'angry')
  block(frames.angry, m.x, m.y, m.w, t, dark)

  frames.sad = make()
  brow(frames.sad, 'browR', 'sad')
  brow(frames.sad, 'browL', 'sad')
  curve(frames.sad, { ...m, h: Math.max(m.h, 2 * t) }, 0.7, -1)

  frames.shy = make()
  eyes.forEach((e) => block(frames.shy, e.x, e.y + e.h + t, e.w, Math.max(t, k / 3), [255, 120, 150, 255], 0.5))

  frames.interested = make()
  brow(frames.interested, 'browR', 'up')
  brow(frames.interested, 'browL', 'up')
  eyes.forEach((e) => block(frames.interested, e.x + Math.round(e.w * 0.25), e.y + Math.round(e.h * 0.2), t, t, [255, 255, 255, 255]))

  frames.surprised = make()
  brow(frames.surprised, 'browR', 'up')
  brow(frames.surprised, 'browL', 'up')
  block(frames.surprised, m.x + m.w / 2 - Math.max(t, m.w / 4) / 2, m.y, Math.max(t, m.w / 4), Math.max(t * 2, m.h), mouthDark)

  frames.crying = make()
  eyes.forEach((e) => {
    cover(frames.crying, e)
    curve(frames.crying, e, 0.45, 0.6)
    block(frames.crying, e.x + e.w / 2 - t / 2, e.y + e.h * 0.7, t, Math.max(3 * t, e.h), [110, 190, 255, 255], 0.9)
  })
  curve(frames.crying, { ...m, h: Math.max(m.h, 2 * t) }, 0.6, -1)

  return frames
}

// ---- smooth eyes ----------------------------------------------------------------------------

/**
 * Split an eye box for smooth eyes: `iris` (the moving pixels, padded by `pad` so it can
 * shift) and `base` (the eye box with the iris replaced by sclera). With a mask the iris is
 * exactly the selected pixels; without one, every pixel unlike the sclera.
 */
export function eyeParts(face: Img, r: Rect, mask: Img | undefined, sclera: RGBA, pad: number) {
  const iris = createImg(r.w + 2 * pad, r.h + 2 * pad)
  const base = createImg(r.w, r.h)
  const useMask = hasAny(mask)
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const p = getPixel(face, r.x + x, r.y + y)
      const isIris = useMask ? masked(mask, r.x + x, r.y + y) : p[3] > 0 && dist(p, sclera) >= 24
      if (isIris && p[3] > 0) {
        iris.data.set(p, ((y + pad) * iris.w + x + pad) * 4)
        base.data.set(sclera, (y * r.w + x) * 4)
      } else base.data.set(p, (y * r.w + x) * 4)
    }
  return { iris, base }
}

/** Iris only (no mask). */
export function irisImage(face: Img, r: Rect, sclera: RGBA, pad: number): Img {
  return eyeParts(face, r, undefined, sclera, pad).iris
}

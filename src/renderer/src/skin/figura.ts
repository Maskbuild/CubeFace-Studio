import type { Rect } from './layout'
import { createImg, fillRect, getPixel, type Img, type RGBA } from './pixels'

export const EXPRESSIONS = ['angry', 'happy', 'shy', 'interested', 'surprised', 'crying', 'sad'] as const
export type Expression = (typeof EXPRESSIONS)[number]
/** Face overlay frames: expressions plus the blink and talking frames. */
export type FaceFrame = Expression | 'blink' | 'talk'
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
  mouth: Rect
  expressions: boolean
  talk: boolean // mouth moves while speaking (Plasmo Voice via FigExtra)
  talkThreshold: number
  ears: EarType
  tail: TailType
  furColor: string
  furInner: string
  extrasPhysics: boolean
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
    mouth: { x: 3 * k, y: 6 * k, w: 2 * k, h: 1 * k },
    expressions: true,
    talk: true,
    talkThreshold: 0.05,
    ears: 'none',
    tail: 'none',
    furColor: '#6b4a33',
    furInner: '#f2b8c6',
    extrasPhysics: true,
    avatarName: '',
    author: '',
    description: ''
  }
}

export function scaleConfig(c: FiguraConfig, from: number, to: number): FiguraConfig {
  const f = to / from
  const r = (x: Rect): Rect => ({ x: Math.round(x.x * f), y: Math.round(x.y * f), w: Math.max(1, Math.round(x.w * f)), h: Math.max(1, Math.round(x.h * f)) })
  return { ...c, eyeR: r(c.eyeR), eyeL: r(c.eyeL), mouth: r(c.mouth), eyeShift: Math.max(1, Math.round(c.eyeShift * f)) }
}

/** Head front face in skin texels. */
export const faceOrigin = (res: number) => ({ x: (8 * res) / 64, y: (8 * res) / 64, size: (8 * res) / 64 })

// ---- procedural default frames ----------------------------------------------------------

const lum = (c: RGBA) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11

/** Colours sampled from the face: skin (just above the eyes), the darkest eye pixel, and the lightest (sclera). */
export function sampleFace(face: Img, c: FiguraConfig) {
  const at = (x: number, y: number): RGBA => getPixel(face, Math.max(0, Math.min(face.w - 1, x)), Math.max(0, Math.min(face.h - 1, y)))
  const skin = at(c.eyeR.x + c.eyeR.w + 1, c.eyeR.y - 1)
  let dark: RGBA = [30, 30, 40, 255]
  let light: RGBA = [255, 255, 255, 255]
  let lo = Infinity, hi = -Infinity
  for (const r of [c.eyeR, c.eyeL])
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const p = at(x, y)
        if (p[3] < 128) continue
        if (lum(p) < lo) (lo = lum(p)), (dark = p)
        if (lum(p) > hi) (hi = lum(p)), (light = p)
      }
  return { skin: [skin[0], skin[1], skin[2], 255] as RGBA, dark, light }
}

/** Does this frame hide the open eyes (so iris planes must be hidden while it shows)? */
export const coversEyes = (f: FaceFrame) => f === 'blink' || f === 'happy' || f === 'crying'

/**
 * Generate simple pixel-art defaults for every face frame from the eye/mouth rects.
 * `face` is the current head-front texture; frames are face-sized overlays (transparent
 * where they don't change anything) that the user can repaint afterwards.
 */
export function generateFrames(face: Img, c: FiguraConfig): Record<FaceFrame, Img> {
  const n = face.w
  const k = Math.max(1, n / 8)
  const { skin, dark } = sampleFace(face, c)
  const t = Math.max(1, Math.round(k / 2)) // line thickness
  const make = () => createImg(n, n)
  const px = (img: Img, x: number, y: number, w: number, h: number, col: RGBA, a = 1) => {
    const r = { x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }
    const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y)
    const x1 = Math.min(n, r.x + r.w), y1 = Math.min(n, r.y + r.h)
    if (x1 > x0 && y1 > y0) fillRect(img, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, col, a)
  }
  const eyes = [c.eyeR, c.eyeL]
  const closeEyes = (img: Img) => eyes.forEach((e) => px(img, e.x, e.y, e.w, e.h, skin))
  const brow = (img: Img, inward: 1 | -1) => {
    // inward=1: inner end lower (angry); -1: inner end higher (sad)
    eyes.forEach((e, i) => {
      const inner = i === 0 ? e.x + e.w - t : e.x // right eye's inner side faces the centre
      const outer = i === 0 ? e.x : e.x + e.w - t
      const y = e.y - 2 * t
      px(img, outer, y - (inward === 1 ? t : 0), t, t, dark)
      px(img, inner, y - (inward === 1 ? 0 : t), t, t, dark)
      px(img, Math.min(inner, outer) + t, y - t / 2, Math.max(t, e.w - 2 * t), t, dark)
    })
  }
  const m = c.mouth
  const frames = {} as Record<FaceFrame, Img>

  frames.blink = make()
  closeEyes(frames.blink)
  eyes.forEach((e) => px(frames.blink, e.x, e.y + e.h - t, e.w, t, dark))

  frames.talk = make()
  px(frames.talk, m.x, m.y, m.w, Math.max(m.h, 2 * t), [70, 25, 30, 255])

  frames.happy = make()
  closeEyes(frames.happy)
  eyes.forEach((e) => {
    px(frames.happy, e.x, e.y + e.h - t, t, t, dark) // ^ shape
    px(frames.happy, e.x + t, e.y, Math.max(t, e.w - 2 * t), t, dark)
    px(frames.happy, e.x + e.w - t, e.y + e.h - t, t, t, dark)
  })
  px(frames.happy, m.x - t, m.y - t, t, t, dark)
  px(frames.happy, m.x + m.w, m.y - t, t, t, dark)
  px(frames.happy, m.x, m.y, m.w, t, dark)

  frames.angry = make()
  brow(frames.angry, 1)
  px(frames.angry, m.x, m.y, m.w, t, dark)

  frames.sad = make()
  brow(frames.sad, -1)
  px(frames.sad, m.x - t, m.y + t, t, t, dark)
  px(frames.sad, m.x + m.w, m.y + t, t, t, dark)
  px(frames.sad, m.x, m.y, m.w, t, dark)

  frames.shy = make()
  eyes.forEach((e) => px(frames.shy, e.x, e.y + e.h + t, e.w, t, [255, 120, 150, 255], 0.55))

  frames.interested = make()
  eyes.forEach((e) => px(frames.interested, e.x, e.y, t, t, [255, 255, 255, 255]))
  brow(frames.interested, -1)

  frames.surprised = make()
  eyes.forEach((e) => px(frames.surprised, e.x, e.y - t, e.w, t, dark))
  px(frames.surprised, m.x + m.w / 2 - t / 2, m.y, Math.max(t, m.w / 2), Math.max(t, m.h), [70, 25, 30, 255])

  frames.crying = make()
  closeEyes(frames.crying)
  eyes.forEach((e) => {
    px(frames.crying, e.x, e.y, e.w, t, dark)
    px(frames.crying, e.x + e.w / 2 - t / 2, e.y + t, t, 3 * t, [110, 190, 255, 255], 0.9)
  })
  px(frames.crying, m.x, m.y + t, m.w, t, dark)

  return frames
}

/** Split an eye rect into iris (pixels unlike the sclera) for smooth-eye planes. */
export function irisImage(face: Img, r: Rect, sclera: RGBA, pad: number): Img {
  const out = createImg(r.w + 2 * pad, r.h + 2 * pad)
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const p = getPixel(face, r.x + x, r.y + y)
      const same = Math.abs(p[0] - sclera[0]) + Math.abs(p[1] - sclera[1]) + Math.abs(p[2] - sclera[2]) < 24
      if (!same && p[3] > 0) out.data.set(p, ((y + pad) * out.w + x + pad) * 4)
    }
  return out
}

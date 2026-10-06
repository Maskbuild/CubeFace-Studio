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
/**
 * Face overlay frames: "base" replaces the skin's own face in Figura (always shown, under
 * everything else), then blink / talk / expressions drawn on top of it.
 */
export type FaceFrame = Expression | 'base' | 'blink' | 'talk' | CustomFrame
/** Any expression shown on the action wheel (built-in or custom). */
export type ExprKey = Expression | CustomFrame
export const FACE_FRAMES: FaceFrame[] = ['base', 'blink', 'talk', ...EXPRESSIONS]

/** How an expression's action-wheel button looks: an item id or an emoji (auria wheel). */
export interface WheelButton {
  title: string
  icon: string // e.g. "minecraft:sunflower" or ":smile:" (emoji only works with the auria wheel)
  color?: string // "#rrggbb" button colour (Figura wheel)
  hidden?: boolean // leave this expression off the wheel
}

/** Extra buttons the wheel can carry besides expressions. */
export interface WheelExtras {
  clear: boolean // "back to normal face"
  physics: boolean // turn hair physics on/off
}

export const DEFAULT_BUTTONS: Record<Expression, WheelButton> = {
  angry: { title: 'Angry', icon: 'minecraft:blaze_powder' },
  happy: { title: 'Happy', icon: 'minecraft:sunflower' },
  shy: { title: 'Shy', icon: 'minecraft:pink_tulip' },
  interested: { title: 'Interested', icon: 'minecraft:spyglass' },
  surprised: { title: 'Surprised', icon: 'minecraft:firework_rocket' },
  crying: { title: 'Crying', icon: 'minecraft:water_bucket' },
  sad: { title: 'Sad', icon: 'minecraft:blue_orchid' }
}

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
  eyeR: Rect // player's right eye (appears on the left of the face)
  eyeL: Rect
  mouth: Rect
  /** Hide only the vanilla parts this avatar replaces (so it can be merged), or the whole player. */
  hideVanilla: 'used' | 'all'
  expressions: boolean
  talk: boolean // mouth moves while speaking (Plasmo Voice via FigExtra)
  talkThreshold: number
  customExpr: CustomExpr[]
  /** Action wheel: Figura's built-in one, or the bundled auria wheel (MIT, by AuriaFoxGirl). */
  wheel: 'figura' | 'auria'
  /** Button title/icon per expression (overrides the defaults). */
  buttons: Partial<Record<ExprKey, WheelButton>>
  /** Button order on the wheel (expressions not listed go last). */
  wheelOrder: ExprKey[]
  wheelTitle: string
  wheelExtras: WheelExtras
  /** Library avatars added to this skin (previewed together, exported as separate folders). */
  attached: { id: string; enabled: boolean }[]
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
    eyeR: { x: 1 * k, y: 4 * k, w: 2 * k, h: 1 * k },
    eyeL: { x: 5 * k, y: 4 * k, w: 2 * k, h: 1 * k },
    mouth: { x: 3 * k, y: 6 * k, w: 2 * k, h: 1 * k },
    hideVanilla: 'used',
    expressions: true,
    talk: true,
    talkThreshold: 0.05,
    customExpr: [],
    wheel: 'figura',
    buttons: {},
    wheelOrder: [],
    wheelTitle: 'Expressions',
    wheelExtras: { clear: true, physics: false },
    attached: [],
    avatarName: '',
    author: '',
    description: ''
  }
}

export function scaleConfig(c: FiguraConfig, from: number, to: number): FiguraConfig {
  const f = to / from
  const r = (x: Rect): Rect => ({ x: Math.round(x.x * f), y: Math.round(x.y * f), w: Math.max(1, Math.round(x.w * f)), h: Math.max(1, Math.round(x.h * f)) })
  return { ...c, eyeR: r(c.eyeR), eyeL: r(c.eyeL), mouth: r(c.mouth) }
}

/** Head front face in skin texels. */
export const faceOrigin = (res: number) => ({ x: (8 * res) / 64, y: (8 * res) / 64, size: (8 * res) / 64 })

export const customKey = (c: CustomExpr): CustomFrame => `x_${c.id}`
/** Built-in expressions followed by custom ones, in action-wheel order. */
export const exprKeys = (cfg: FiguraConfig): ExprKey[] => [...EXPRESSIONS, ...cfg.customExpr.map(customKey)]
/** All face frames for a config, back to front (base, blink, talk, built-ins, custom). */
export const allFrames = (cfg: FiguraConfig): FaceFrame[] => [...FACE_FRAMES, ...cfg.customExpr.map(customKey)]

/** The button for an expression: user override, built-in default, or the custom name. */
export function wheelButton(cfg: FiguraConfig, e: ExprKey): WheelButton {
  const own = cfg.buttons[e]
  if (e.startsWith('x_')) {
    const c = cfg.customExpr.find((x) => customKey(x) === e)
    return { title: own?.title || c?.name || 'Custom', icon: own?.icon || 'minecraft:name_tag', color: own?.color, hidden: own?.hidden }
  }
  const d = DEFAULT_BUTTONS[e as Expression]
  return { title: own?.title || d.title, icon: own?.icon || d.icon, color: own?.color, hidden: own?.hidden }
}

/** Expressions in wheel order (custom order first, then any not yet ordered). */
export function orderedExprs(cfg: FiguraConfig): ExprKey[] {
  const all = exprKeys(cfg)
  return [...cfg.wheelOrder.filter((e) => all.includes(e)), ...all.filter((e) => !cfg.wheelOrder.includes(e))]
}

/** Does this frame hide the open eyes? */
export const coversEyes = (f: FaceFrame, cfg?: FiguraConfig) =>
  f === 'blink' || f === 'happy' || f === 'crying' || (f.startsWith('x_') && !!cfg?.customExpr.find((c) => 'x_' + c.id === f)?.coversEyes)

// ---- procedural default frames ----------------------------------------------------------

const lum = (c: RGBA) => (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255
const dist = (a: RGBA, b: RGBA) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])

function eachIn(r: Rect, n: number, fn: (x: number, y: number) => void) {
  for (let y = Math.max(0, r.y); y < Math.min(n, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(n, r.x + r.w); x++) fn(x, y)
}

/** Most common opaque colour in a region (quantised), e.g. the skin tone around the eyes. */
function modeColor(face: Img, r: Rect): RGBA | null {
  const counts = new Map<number, { n: number; c: RGBA }>()
  eachIn(r, face.w, (x, y) => {
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

/** Colours sampled from the face: skin (cheeks below the eyes) and the darkest eye pixel. */
export function sampleFace(face: Img, c: FiguraConfig) {
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
  return { skin, dark }
}

/** The strip just above an eye box, where its eyebrow usually is. */
export const browRect = (e: Rect): Rect => {
  const h = Math.max(1, Math.round(e.h * 0.8))
  return { x: e.x, y: Math.max(0, e.y - h), w: e.w, h }
}

/**
 * Generate pixel-art defaults for every face frame from the eye and mouth boxes. Closed-eye
 * frames cover the eye box with the cheek skin tone; eyebrows (dark pixels just above each eye)
 * are tilted or lifted. Frames are face-sized overlays and can be repainted afterwards.
 */
export function generateFrames(face: Img, c: FiguraConfig): Record<FaceFrame, Img> {
  const n = face.w
  const k = Math.max(1, n / 8)
  const { skin, dark } = sampleFace(face, c)
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
  const brow = (img: Img, eye: Rect, right: boolean, mode: 'angry' | 'sad' | 'up') => {
    const r = browRect(eye)
    const px: { x: number; y: number; p: RGBA }[] = []
    eachIn(r, n, (x, y) => {
      const p = getPixel(face, x, y)
      if (p[3] > 127 && dist(p, skin) > 90 && lum(p) < lum(skin)) px.push({ x, y, p })
    })
    if (!px.length) {
      // nothing painted there yet: draw a simple brow line
      for (let x = r.x; x < r.x + r.w; x++) px.push({ x, y: r.y + Math.floor(r.h / 2), p: dark })
    } else for (const q of px) put(img, q.x, q.y, skin) // erase the original brow
    // the right eye is on the viewer's left, so its inner end is at the right of its box
    const lift = Math.max(t, Math.round(Math.max(r.h, eye.h) / 3))
    for (const q of px) {
      const u = right ? (q.x - r.x) / Math.max(1, r.w - 1) : 1 - (q.x - r.x) / Math.max(1, r.w - 1)
      const dy = mode === 'up' ? -lift : Math.round((mode === 'angry' ? 1 : -1) * u * lift)
      put(img, q.x, q.y + dy, q.p)
    }
  }
  const brows = (img: Img, mode: 'angry' | 'sad' | 'up') => {
    brow(img, c.eyeR, true, mode)
    brow(img, c.eyeL, false, mode)
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
  brows(frames.angry, 'angry')
  block(frames.angry, m.x, m.y, m.w, t, dark)

  frames.sad = make()
  brows(frames.sad, 'sad')
  curve(frames.sad, { ...m, h: Math.max(m.h, 2 * t) }, 0.7, -1)

  frames.shy = make()
  eyes.forEach((e) => block(frames.shy, e.x, e.y + e.h + t, e.w, Math.max(t, k / 3), [255, 120, 150, 255], 0.5))

  frames.interested = make()
  brows(frames.interested, 'up')
  eyes.forEach((e) => block(frames.interested, e.x + Math.round(e.w * 0.25), e.y + Math.round(e.h * 0.2), t, t, [255, 255, 255, 255]))

  frames.surprised = make()
  brows(frames.surprised, 'up')
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

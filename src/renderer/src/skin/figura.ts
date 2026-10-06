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

// ---- action wheel ---------------------------------------------------------------------------

export type IconSize = 16 | 32 | 64
/** Uploaded icons are scaled to fit one of these squares (Figura draws icons 16 GUI px wide). */
export const ICON_SIZES: IconSize[] = [16, 32, 64]
export type WheelIcon =
  | { kind: 'item'; id: string } // any Minecraft item, e.g. "minecraft:sunflower"
  | { kind: 'emoji'; text: string } // ":smile:" (auria wheel only)
  | { kind: 'image'; src: string; size: IconSize } // uploaded picture (PNG data URL), packed into the atlas
  | { kind: 'face'; frame: FaceFrame } // the expression's own face frame (already in the atlas)

/** Things a wheel toggle can switch on/off in game. */
export type WheelToggle = 'blink' | 'physics' | 'smoothHead' | 'talk' | 'glow' | 'eyes'
export const WHEEL_TOGGLES: WheelToggle[] = ['blink', 'physics', 'smoothHead', 'talk', 'glow', 'eyes']

export interface WheelItem {
  id: string
  /** expr: show an expression · page: open another page · toggle: switch a feature · clear: normal face */
  type: 'expr' | 'page' | 'toggle' | 'clear'
  title: string // '' = default title (English only in game)
  icon?: WheelIcon // undefined = default icon
  color?: string // "#rrggbb" (Figura wheel)
  hidden?: boolean
  expr?: ExprKey
  page?: string // target page id
  toggle?: WheelToggle
}

export interface WheelPage {
  id: string
  title: string
  items: WheelItem[]
  /** New expressions are added to this page automatically. */
  auto?: boolean
  /** Buttons per ring before paging (auria wheel); empty = all on one ring. */
  groupSize?: number
}

/** Look and feel of the auria wheel (written to its conf.lua). */
export interface AuriaStyle {
  overlay: string // "#rrggbb" screen tint behind the wheel
  overlayAlpha: number // 0..1
  blur: boolean
  mode: 'HOLD' | 'MIXED' | 'TOGGLE' // how the wheel key opens it
  holdTime: number // ms before a press counts as "held" (MIXED)
  animationSpeed: number // 0..1
  animations: boolean
}

export const DEFAULT_EXPR: Record<Expression, { title: string; icon: string }> = {
  angry: { title: 'Angry', icon: 'minecraft:blaze_powder' },
  happy: { title: 'Happy', icon: 'minecraft:sunflower' },
  shy: { title: 'Shy', icon: 'minecraft:pink_tulip' },
  interested: { title: 'Interested', icon: 'minecraft:spyglass' },
  surprised: { title: 'Surprised', icon: 'minecraft:firework_rocket' },
  crying: { title: 'Crying', icon: 'minecraft:water_bucket' },
  sad: { title: 'Sad', icon: 'minecraft:blue_orchid' }
}
export const DEFAULT_TOGGLE: Record<WheelToggle, { title: string; icon: string }> = {
  blink: { title: 'Blinking', icon: 'minecraft:ender_eye' },
  physics: { title: 'Hair physics', icon: 'minecraft:feather' },
  smoothHead: { title: 'Smooth head', icon: 'minecraft:armor_stand' },
  talk: { title: 'Talking mouth', icon: 'minecraft:note_block' },
  glow: { title: 'Glow', icon: 'minecraft:glowstone_dust' },
  eyes: { title: 'Eyes follow', icon: 'minecraft:ender_eye' }
}
export const DEFAULT_AURIA: AuriaStyle = { overlay: '#33383f', overlayAlpha: 0.5, blur: true, mode: 'MIXED', holdTime: 250, animationSpeed: 0.5, animations: true }

let wid = 0
export const wheelId = () => Date.now().toString(36) + (wid++).toString(36)

/** Main page: open the expressions page, toggle blinking, toggle hair physics. */
export function defaultWheel(): WheelPage[] {
  return [
    {
      id: 'main',
      title: 'Main',
      items: [
        { id: 'go_faces', type: 'page', page: 'faces', title: 'Expressions', icon: { kind: 'item', id: 'minecraft:painting' } },
        { id: 't_blink', type: 'toggle', toggle: 'blink', title: '' },
        { id: 't_physics', type: 'toggle', toggle: 'physics', title: '' },
        { id: 't_glow', type: 'toggle', toggle: 'glow', title: '' }
      ]
    },
    { id: 'faces', title: 'Expressions', auto: true, items: [{ id: 'clear', type: 'clear', title: 'Normal face', icon: { kind: 'item', id: 'minecraft:barrier' } }] }
  ]
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
  /** Pages of the wheel; the first one opens first. */
  wheelPages: WheelPage[]
  auriaStyle: AuriaStyle
  /** Minecraft version used for item icons in the app (the game draws its own). */
  iconVersion: '1.20.1' | '1.21.1' | '1.21.4'
  /**
   * Skin parts inside the avatar. "needed": only what Figura must draw itself (the head when the
   * smooth head is on); the rest is the player's normal skin. "all": every painted part.
   */
  skinParts: 'needed' | 'all'
  /** Face frames that glow in the dark (e.g. the base face for glowing eyes). */
  glowFrames: FaceFrame[]
  /** Eyes look where the player turns (the iris slides inside the eye boxes). */
  eyeFollow: boolean
  /** How far the iris can slide, in face texels. */
  eyeRange: number
  /** Head tilts a little while turning (degrees, smooth head only). */
  headTilt: number
  /** Wheel layout version (adds new built-in buttons once to older wheels). */
  wheelV?: number
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
    wheelPages: defaultWheel(),
    auriaStyle: { ...DEFAULT_AURIA },
    iconVersion: '1.21.4',
    skinParts: 'needed',
    glowFrames: [],
    eyeFollow: true,
    eyeRange: k,
    headTilt: 6,
    wheelV: 2,
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

/** Parse the old one-string icons ("minecraft:x" / ":emoji:"). */
export const parseIcon = (s: string): WheelIcon => (/^:[\w@+-]+:$/.test(s.trim()) ? { kind: 'emoji', text: s.trim() } : { kind: 'item', id: s.trim() || 'minecraft:name_tag' })

/** Title, icon and colour of a wheel item with defaults filled in. */
export function itemView(cfg: FiguraConfig, it: WheelItem): { title: string; icon: WheelIcon; color?: string } {
  let title = it.title
  let icon = it.icon
  if (it.type === 'expr' && it.expr) {
    const d = it.expr.startsWith('x_') ? undefined : DEFAULT_EXPR[it.expr as Expression]
    title ||= d?.title ?? cfg.customExpr.find((c) => customKey(c) === it.expr)?.name ?? 'Custom'
    icon ??= d ? parseIcon(d.icon) : { kind: 'face', frame: it.expr }
  } else if (it.type === 'toggle' && it.toggle) {
    title ||= DEFAULT_TOGGLE[it.toggle].title
    icon ??= parseIcon(DEFAULT_TOGGLE[it.toggle].icon)
  } else if (it.type === 'page') {
    title ||= cfg.wheelPages.find((p) => p.id === it.page)?.title || 'Page'
    icon ??= { kind: 'item', id: 'minecraft:book' }
  } else if (it.type === 'clear') {
    title ||= 'Normal face'
    icon ??= { kind: 'item', id: 'minecraft:barrier' }
  }
  return { title: toEnglish(title) || 'Action', icon: icon ?? { kind: 'item', id: 'minecraft:name_tag' }, color: it.color }
}

/**
 * Pages with every expression placed exactly once (new ones go to the "auto" page, deleted
 * custom ones are dropped) and links to deleted pages removed.
 */
export function syncWheel(cfg: FiguraConfig): WheelPage[] {
  let pages = cfg.wheelPages?.length ? cfg.wheelPages : defaultWheel()
  const exprs = exprKeys(cfg)
  const ids = new Set(pages.map((p) => p.id))
  const seen = new Set<string>()
  pages = pages.map((p) => ({
    ...p,
    items: p.items.filter((it) => {
      if (it.type === 'page') return !!it.page && ids.has(it.page) && it.page !== p.id
      if (it.type !== 'expr') return true
      if (!it.expr || !exprs.includes(it.expr) || seen.has(it.expr)) return false
      seen.add(it.expr)
      return true
    })
  }))
  const missing = exprs.filter((e) => !seen.has(e))
  if (missing.length) {
    const i = Math.max(0, pages.findIndex((p) => p.auto))
    const page = pages[i]
    const add = missing.map((e): WheelItem => ({ id: 'e_' + e, type: 'expr', expr: e, title: '' }))
    // keep a trailing "normal face" button last
    const at = page.items.length && page.items[page.items.length - 1].type === 'clear' ? page.items.length - 1 : page.items.length
    pages[i] = { ...page, items: [...page.items.slice(0, at), ...add, ...page.items.slice(at)] }
  }
  return pages
}

/** What the exported avatar can actually do, to drop buttons that would do nothing. */
export interface WheelContext {
  frames: (f: FaceFrame) => boolean // face frame exported
  physics: boolean // hair chains exported with physics
  glow?: boolean // a glow texture is exported
  eyes?: boolean // eye-follow planes are exported
}

/** Visible, working wheel: hidden/inactive items removed, empty pages and links to them dropped. */
export function liveWheel(cfg: FiguraConfig, ctx: WheelContext): WheelPage[] {
  const works = (it: WheelItem) => {
    if (it.hidden) return false
    if (it.type === 'expr') return cfg.expressions && !!it.expr && ctx.frames(it.expr)
    if (it.type === 'clear') return cfg.expressions
    if (it.type === 'toggle')
      if (it.toggle === 'glow') return !!ctx.glow
    if (it.toggle === 'eyes') return !!ctx.eyes
    return it.toggle === 'physics' ? ctx.physics : it.toggle === 'blink' ? cfg.blink && ctx.frames('blink') : it.toggle === 'talk' ? cfg.talk && ctx.frames('talk') : cfg.smoothHead
    return true
  }
  let pages = syncWheel(cfg).map((p) => ({ ...p, items: p.items.filter(works) }))
  // "normal face" only makes sense next to expressions
  const anyExpr = pages.some((p) => p.items.some((i) => i.type === 'expr'))
  if (!anyExpr) pages = pages.map((p) => ({ ...p, items: p.items.filter((i) => i.type !== 'clear') }))
  // drop links to empty pages until stable (a page holding only dead links is empty too)
  for (let n = 0; n < 8; n++) {
    const empty = new Set(pages.filter((p, i) => i > 0 && !p.items.length).map((p) => p.id))
    const next = pages.map((p) => ({ ...p, items: p.items.filter((it) => it.type !== 'page' || !empty.has(it.page!)) }))
    if (next.every((p, i) => p.items.length === pages[i].items.length)) break
    pages = next
  }
  return pages
}

/** Convert a config saved before wheel pages existed. */
export function migrateWheel(cfg: Partial<FiguraConfig> & Record<string, unknown>): Partial<FiguraConfig> {
  if (cfg.wheelPages) {
    // v2: the glow switch joins the main page once
    if ((cfg.wheelV ?? 1) < 2 && cfg.wheelPages[0] && !cfg.wheelPages.some((p) => p.items.some((i) => i.toggle === 'glow'))) {
      const [main, ...rest] = cfg.wheelPages
      return { ...cfg, wheelV: 2, wheelPages: [{ ...main, items: [...main.items, { id: 't_glow', type: 'toggle', toggle: 'glow', title: '' }] }, ...rest] }
    }
    return cfg
  }
  const old = (cfg.buttons ?? {}) as Partial<Record<ExprKey, { title?: string; icon?: string; color?: string; hidden?: boolean }>>
  const order = (cfg.wheelOrder ?? []) as ExprKey[]
  const pages = defaultWheel()
  const faces = pages[1]
  const keys = [...order, ...(Object.keys(old) as ExprKey[]).filter((k) => !order.includes(k))]
  faces.items = [
    ...keys.map((e): WheelItem => {
      const b = old[e] ?? {}
      return { id: 'e_' + e, type: 'expr', expr: e, title: b.title ?? '', icon: b.icon ? parseIcon(b.icon) : undefined, color: b.color, hidden: b.hidden }
    }),
    ...faces.items
  ]
  if (typeof cfg.wheelTitle === 'string' && cfg.wheelTitle) faces.title = cfg.wheelTitle
  const extras = cfg.wheelExtras as { clear?: boolean } | undefined
  if (extras && extras.clear === false) faces.items = faces.items.filter((i) => i.type !== 'clear')
  const { buttons: _b, wheelOrder: _o, wheelTitle: _t, wheelExtras: _e, ...rest } = cfg
  return { ...rest, wheelPages: pages }
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

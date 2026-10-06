/*
 * Poses and keyframe animations in Emotecraft's convention (also used by playerAnimator /
 * bendy-lib): Minecraft model space (y down, front -Z), angles in radians, limb offsets in model
 * pixels relative to each part's default position, "bend" folds a limb at the elbow / knee.
 * "body" moves the whole player (offset in blocks, turning around the hips).
 * Format reference: KosmX/minecraftPlayerAnimator AnimationBinary + AnimationJson, KosmX/emotes.
 */

export const BONES = ['head', 'torso', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg', 'body'] as const
export type Bone = (typeof BONES)[number]
export const AXES = ['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'bend', 'axis'] as const
export type Axis = (typeof AXES)[number]
export type BoneState = Partial<Record<Axis, number>>
export type PoseState = Partial<Record<Bone, BoneState>>

export const ROT_AXES: Axis[] = ['pitch', 'yaw', 'roll', 'bend', 'axis']

export interface Keyframe {
  tick: number
  value: number
  easing: string
}

export interface Emote {
  id: string
  name: string
  author: string
  description: string
  beginTick: number
  endTick: number
  stopTick: number
  loop: boolean
  returnTick: number
  /** The easing written on a keyframe shapes the movement into it (true) or out of it (false). */
  easeBefore: boolean
  tracks: Partial<Record<Bone, Partial<Record<Axis, Keyframe[]>>>>
  builtin?: boolean
  /** PNG data URL shipped with the emote. */
  icon?: string
}

/** Default part positions in Emotecraft files (values there are absolute; we keep offsets). */
const DEFAULT_POS: Partial<Record<Bone, [number, number, number]>> = {
  rightArm: [-5, 2, 0],
  leftArm: [5, 2, 0],
  rightLeg: [-1.9, 12, 0.1],
  leftLeg: [1.9, 12, 0.1]
}
const posDefault = (b: Bone, a: Axis) => (a === 'x' ? DEFAULT_POS[b]?.[0] : a === 'y' ? DEFAULT_POS[b]?.[1] : a === 'z' ? DEFAULT_POS[b]?.[2] : 0) ?? 0

/** Easing names by binary id (playerAnimator Ease). */
const EASE_IDS: Record<number, string> = {
  0: 'LINEAR', 1: 'CONSTANT', 6: 'EASEINSINE', 7: 'EASEOUTSINE', 8: 'EASEINOUTSINE', 9: 'EASEINCUBIC', 10: 'EASEOUTCUBIC', 11: 'EASEINOUTCUBIC',
  12: 'EASEINQUAD', 13: 'EASEOUTQUAD', 14: 'EASEINOUTQUAD', 15: 'EASEINQUART', 16: 'EASEOUTQUART', 17: 'EASEINOUTQUART', 18: 'EASEINQUINT',
  19: 'EASEOUTQUINT', 20: 'EASEINOUTQUINT', 21: 'EASEINEXPO', 22: 'EASEOUTEXPO', 23: 'EASEINOUTEXPO', 24: 'EASEINCIRC', 25: 'EASEOUTCIRC',
  26: 'EASEINOUTCIRC', 27: 'EASEINBACK', 28: 'EASEOUTBACK', 29: 'EASEINOUTBACK', 30: 'EASEINELASTIC', 31: 'EASEOUTELASTIC', 32: 'EASEINOUTELASTIC',
  33: 'EASEINBOUNCE', 34: 'EASEOUTBOUNCE', 35: 'EASEINOUTBOUNCE', 36: 'EASEINOUTSINE', 37: 'CONSTANT'
}

// ---- easing (Emotecraft names: EASEINOUTQUAD, LINEAR, CONSTANT, …) -----------------------------
const PI = Math.PI
const bounceOut = (x: number) => {
  const n = 7.5625, d = 2.75
  if (x < 1 / d) return n * x * x
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375
  return n * (x -= 2.625 / d) * x + 0.984375
}
const IN: Record<string, (x: number) => number> = {
  SINE: (x) => 1 - Math.cos((x * PI) / 2),
  QUAD: (x) => x * x,
  CUBIC: (x) => x ** 3,
  QUART: (x) => x ** 4,
  QUINT: (x) => x ** 5,
  EXPO: (x) => (x === 0 ? 0 : 2 ** (10 * x - 10)),
  CIRC: (x) => 1 - Math.sqrt(1 - x * x),
  BACK: (x) => 2.70158 * x ** 3 - 1.70158 * x * x,
  ELASTIC: (x) => (x === 0 || x === 1 ? x : -(2 ** (10 * x - 10)) * Math.sin((x * 10 - 10.75) * ((2 * PI) / 3))),
  BOUNCE: (x) => 1 - bounceOut(1 - x)
}

export function ease(name: string, x: number): number {
  const n = (name || 'LINEAR').toUpperCase().replace(/[^A-Z]/g, '')
  if (n === 'CONSTANT' || n === 'STEP') return 0
  const m = /^EASE(INOUT|IN|OUT)([A-Z]+)$/.exec(n)
  if (!m || !IN[m[2]]) return x
  const f = IN[m[2]]
  if (m[1] === 'IN') return f(x)
  if (m[1] === 'OUT') return 1 - f(1 - x)
  return x < 0.5 ? f(x * 2) / 2 : 1 - f((1 - x) * 2) / 2
}

// ---- Emotecraft JSON --------------------------------------------------------------------------
const truthy = (v: unknown) => v === true || v === 'true' || v === 1
let n = 0
export const emoteId = () => 'em' + Date.now().toString(36) + (n++).toString(36)

/** Parse an Emotecraft / playerAnimator JSON emote. Throws with a readable message on bad files. */
export function parseEmotecraft(text: string, fallbackName = 'Emote'): Emote {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(text)
  } catch {
    throw new Error('not a JSON file')
  }
  const e = j.emote as Record<string, unknown> | undefined
  if (!e || !Array.isArray(e.moves)) throw new Error('not an Emotecraft emote (no "emote.moves")')
  const degrees = truthy(e.degrees)
  const version = Number(j.version) || 1
  const tracks: Emote['tracks'] = {}
  let last = 0
  for (const mv of e.moves as Record<string, unknown>[]) {
    const tick = Number(mv.tick) || 0
    last = Math.max(last, tick)
    const easing = typeof mv.easing === 'string' ? mv.easing : 'LINEAR'
    const turn = Number(mv.turn) || 0
    for (const b of BONES) {
      // before version 3, "torso" was the name of the body part
      const key = version < 3 ? (b === 'body' ? 'torso' : b === 'torso' ? '' : b) : b
      const part = (key ? mv[key] ?? (version < 3 && b === 'body' ? mv.body : undefined) : undefined) as Record<string, unknown> | undefined
      if (!part || typeof part !== 'object') continue
      for (const a of AXES) {
        if (typeof part[a] !== 'number') continue
        let v = (part[a] as number) - posDefault(b, a)
        if (ROT_AXES.includes(a)) {
          if (degrees) v = (v * PI) / 180
          if (a !== 'bend' && a !== 'axis') v += turn * 2 * PI
        }
        const bt = (tracks[b] ??= {})
        ;(bt[a] ??= []).push({ tick, value: v, easing })
      }
    }
  }
  for (const bt of Object.values(tracks)) for (const k of Object.values(bt!)) k!.sort((p, q) => p.tick - q.tick)
  const endTick = typeof e.endTick === 'number' ? e.endTick : last
  const name = typeof j.name === 'string' ? j.name : typeof j.name === 'object' && j.name ? String((j.name as { text?: string }).text ?? fallbackName) : fallbackName
  const text_ = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'object' && v ? String((v as { text?: string }).text ?? '') : '')
  return {
    id: emoteId(),
    name: name || fallbackName,
    author: text_(j.author),
    description: text_(j.description),
    beginTick: Number(e.beginTick) || 0,
    endTick: Math.max(1, endTick),
    stopTick: typeof e.stopTick === 'number' ? e.stopTick : endTick + 3,
    loop: truthy(e.isLoop),
    returnTick: Number(e.returnTick) || 0,
    easeBefore: e.easeBeforeKeyframe === undefined ? false : truthy(e.easeBeforeKeyframe),
    tracks
  }
}

// ---- Emotecraft binary (.emotecraft) ------------------------------------------------------------
class Reader {
  private dv: DataView
  pos = 0
  constructor(private buf: Uint8Array) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  get left() {
    return this.buf.length - this.pos
  }
  need(n: number) {
    if (n < 0 || this.pos + n > this.buf.length) throw new Error('file is cut short')
  }
  i8() { this.need(1); return this.dv.getInt8(this.pos++) }
  u8() { this.need(1); return this.dv.getUint8(this.pos++) }
  i32() { this.need(4); const v = this.dv.getInt32(this.pos); this.pos += 4; return v }
  f32() { this.need(4); const v = this.dv.getFloat32(this.pos); this.pos += 4; return v }
  bytes(n: number) { this.need(n); const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b }
  str() { return new TextDecoder().decode(this.bytes(this.i32())) }
}

/** Parts the animation library treats as bendable (two extra tracks: bend direction, bend). */
const NOT_BENDABLE = new Set(['head', 'rightItem', 'leftItem'])

function readAnimation(r: Reader, version: number): Pick<Emote, 'beginTick' | 'endTick' | 'stopTick' | 'loop' | 'returnTick' | 'easeBefore' | 'tracks'> {
  const beginTick = r.i32()
  const endTick = r.i32()
  const stopTick = r.i32()
  const loop = r.u8() !== 0
  const returnTick = r.i32()
  const easeBefore = r.u8() !== 0
  r.u8() // nsfw
  const kfSize = r.i8()
  if (kfSize < 9) throw new Error('unsupported keyframe size')
  const tracks: Emote['tracks'] = {}
  const readTrack = (bone: Bone | null, axis: Axis | null) => {
    let len: number
    if (version >= 2) {
      r.u8() // enabled
      len = r.i32()
    } else len = r.i32()
    for (let i = 0; i < len; i++) {
      const at = r.pos
      const tick = r.i32()
      const value = r.f32()
      const easing = EASE_IDS[r.u8()] ?? 'LINEAR'
      r.pos = at + kfSize
      r.need(0)
      if (bone && axis) ((tracks[bone] ??= {})[axis] ??= []).push({ tick, value: value - posDefault(bone, axis), easing })
    }
  }
  const readPart = (name: string) => {
    const bone = (BONES as readonly string[]).includes(name) ? (name as Bone) : null
    for (const a of ['x', 'y', 'z', 'pitch', 'yaw', 'roll'] as Axis[]) readTrack(bone, a)
    if (!NOT_BENDABLE.has(name)) {
      readTrack(bone, 'axis')
      readTrack(bone, 'bend')
    }
    if (version >= 3) for (let i = 0; i < 3; i++) readTrack(null, null) // scale x/y/z (not shown)
  }
  if (version >= 2) {
    const count = r.i32()
    for (let i = 0; i < count; i++) readPart(r.str())
  } else for (const n of ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']) readPart(n)
  for (const bt of Object.values(tracks)) for (const k of Object.values(bt!)) k!.sort((p, q) => p.tick - q.tick)
  return { beginTick, endTick: Math.max(1, endTick), stopTick, loop, returnTick, easeBefore, tracks }
}

/** Header strings are Minecraft text components ("\"Name\"", {"text": …}); translation keys can't be shown. */
function textComponent(s: string): string {
  if (!s) return ''
  try {
    const j = JSON.parse(s)
    if (typeof j === 'string') return j
    if (j && typeof j === 'object') return typeof j.text === 'string' ? j.text + (Array.isArray(j.extra) ? j.extra.map((x: unknown) => (typeof x === 'string' ? x : ((x as { text?: string })?.text ?? ''))).join('') : '') : ''
  } catch {
    /* plain text */
  }
  return s
}

/** Read a binary .emotecraft file (Emotecraft's packet format: header, animation, icon). */
export function parseEmotecraftBinary(bytes: Uint8Array, fallbackName = 'Emote'): Emote {
  const r = new Reader(bytes)
  r.i32() // networking version
  r.u8() // purpose
  const count = r.u8()
  let anim: ReturnType<typeof readAnimation> | null = null
  let name = '', author = '', description = '', icon: string | undefined
  let newFormat = false
  for (let i = 0; i < count && r.left >= 6; i++) {
    const id = r.u8()
    const ver = r.u8()
    const size = r.i32()
    const start = r.pos
    const body = new Reader(r.bytes(size))
    try {
      if (id === 0x00) {
        body.i32() // start tick
        anim = readAnimation(body, ver)
      } else if (id === 0x11) {
        name = textComponent(body.str())
        description = textComponent(body.str())
        author = textComponent(body.str())
      } else if (id === 0x12) {
        const n = body.i32()
        icon = 'data:image/png;base64,' + btoa(Array.from(body.bytes(n), (c) => String.fromCharCode(c)).join(''))
      } else if (id === 0x99) newFormat = true
    } catch (e) {
      if (id === 0x00) throw e
    }
    r.pos = start + size
  }
  if (!anim) throw new Error(newFormat ? 'this emote uses a newer Emotecraft format that is not supported yet' : 'no animation inside')
  return { id: emoteId(), name: name || fallbackName, author, description, icon, ...anim }
}

/** Read any supported emote file (JSON or binary). */
export function parseEmoteFile(bytes: Uint8Array, fileName: string): Emote {
  const base = fileName.replace(/\.[^.]+$/, '')
  const text = bytes[0] === 0x7b || bytes[0] === 0xef || /\.json$/i.test(fileName) ? new TextDecoder().decode(bytes).replace(/^\uFEFF/, '') : null
  return text !== null && text.trimStart().startsWith('{') ? parseEmotecraft(text, base) : parseEmotecraftBinary(bytes, base)
}

/** Value of one track at a (fractional) tick; 0 = the part's default. */
function sampleTrack(keys: Keyframe[], t: number, emote: Emote): number {
  if (!keys.length) return 0
  // before the first keyframe: move from the default pose (Emotecraft starts every part at 0)
  let prev: Keyframe = { tick: emote.beginTick, value: 0, easing: 'LINEAR' }
  for (const k of keys) {
    if (k.tick > t) {
      if (k.tick <= prev.tick) return k.value
      const x = (t - prev.tick) / (k.tick - prev.tick)
      return prev.value + (k.value - prev.value) * ease(emote.easeBefore ? k.easing : prev.easing, Math.min(1, Math.max(0, x)))
    }
    prev = k
  }
  // after the last keyframe: hold it; a one-shot emote eases back to default by stopTick
  if (!emote.loop && t > emote.endTick && emote.stopTick > emote.endTick) {
    const x = Math.min(1, (t - Math.max(prev.tick, emote.endTick)) / (emote.stopTick - Math.max(prev.tick, emote.endTick)))
    return prev.value * (1 - ease('EASEINOUTSINE', x))
  }
  return prev.value
}

/** Map playing time (ticks since start) to the emote's own tick, handling loops. */
export function emoteTick(e: Emote, t: number): number {
  if (!e.loop || t <= e.endTick) return t
  const span = Math.max(1, e.endTick - e.returnTick)
  return e.returnTick + ((t - e.returnTick) % span)
}

export function sampleEmote(e: Emote, t: number): PoseState {
  const tick = emoteTick(e, t)
  const out: PoseState = {}
  for (const [b, bt] of Object.entries(e.tracks) as [Bone, Partial<Record<Axis, Keyframe[]>>][]) {
    const s: BoneState = {}
    for (const [a, keys] of Object.entries(bt) as [Axis, Keyframe[]][]) s[a] = sampleTrack(keys, tick, e)
    out[b] = s
  }
  return out
}

/** Length in ticks shown on the timeline (one loop, or until the emote has ended). */
export const emoteLength = (e: Emote) => (e.loop ? e.endTick : Math.max(e.endTick, e.stopTick))

/** A static pose as an Emotecraft JSON emote (loops forever; usable in Emotecraft). */
export function poseToEmotecraft(pose: PoseState, name: string, author: string, description = ''): string {
  const move: Record<string, unknown> = { tick: 1, easing: 'EASEINOUTQUAD', turn: 0 }
  for (const [b, s] of Object.entries(pose)) {
    const o: Record<string, number> = {}
    for (const [a, v] of Object.entries(s ?? {})) if (v) o[a] = Math.round((v + posDefault(b as Bone, a as Axis)) * 1e4) / 1e4
    if (Object.keys(o).length) move[b] = o
  }
  return JSON.stringify(
    {
      version: 3,
      name,
      author,
      description: description || 'Made with NKW Skin & Figura Custom',
      emote: { beginTick: 0, endTick: 2, stopTick: 5, isLoop: 'true', returnTick: 1, nsfw: false, degrees: false, moves: [move] }
    },
    null,
    2
  )
}

/** Emote as Emotecraft JSON (round trip for imported / built-in animations). */
export function emoteToEmotecraft(e: Emote): string {
  const byTick = new Map<number, Record<string, unknown>>()
  for (const [b, bt] of Object.entries(e.tracks))
    for (const [a, keys] of Object.entries(bt ?? {}))
      for (const k of keys ?? []) {
        const mv = byTick.get(k.tick) ?? { tick: k.tick, easing: k.easing, turn: 0 }
        ;((mv[b] ??= {}) as Record<string, number>)[a] = Math.round((k.value + posDefault(b as Bone, a as Axis)) * 1e4) / 1e4
        byTick.set(k.tick, mv)
      }
  return JSON.stringify(
    {
      version: 3,
      name: e.name,
      author: e.author,
      description: e.description,
      emote: {
        beginTick: e.beginTick,
        endTick: e.endTick,
        stopTick: e.stopTick,
        isLoop: String(e.loop),
        returnTick: e.returnTick,
        nsfw: false,
        degrees: false,
        easeBeforeKeyframe: e.easeBefore,
        moves: [...byTick.values()].sort((a, b) => (a.tick as number) - (b.tick as number))
      }
    },
    null,
    2
  )
}

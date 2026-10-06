import { createImg, type Img } from './pixels'

export type HairSide = 'front' | 'back'
export type HairLength = 'short' | 'medium' | 'long'

/** Physics tuning; the same numbers drive the in-app preview and the exported Lua (nkw_physics.lua). */
export interface HairPhys {
  /** The single user setting: 0 = snappy … 1 = floaty. The values below are derived from it. */
  flow?: number
  stiffness: number // spring pull back to rest, per tick (0..1)
  damping: number // unused: damping is always critical (no bounce); kept for older projects
  gravity: number // how strongly segments keep hanging down when the head tilts (0..1)
  drag: number // swing from movement speed (rad per block/tick)
  sway: number // sideways swing from head turning (0..1)
  limitIn: number // max inward swing in degrees (towards the head; keeps bangs out of the face)
  limitOut: number // max outward swing in degrees
  /** Max inward turn (degrees) to undo the head's tilt: small on the head (no clipping), large below it. */
  tiltIn?: number
}

/**
 * A flat rectangle of hair attached to the head. Units are skin pixels in head space:
 * the head cube spans x -4..4, y 0..8, z -4..4 with the neck pivot at the origin.
 * `pos` is the top-centre edge of the plane; the plane hangs down `h` pixels.
 */
export interface HairPlane {
  id: string
  name: string
  visible: boolean
  side: HairSide
  length: HairLength
  pos: [number, number, number]
  rot: [number, number, number] // rest pitch/yaw/roll in degrees
  w: number
  h: number
  segments: number
  phys: HairPhys
  presetId?: string // (older projects) the plane came from a removed Figura preset
  glow?: boolean // glows in the dark in Figura
  /** Hang down with gravity when the head bends (default on). */
  hang?: boolean
  /** Rest curve in degrees over the whole plane (+ = curls outward, like bangs). */
  curl?: number
  /** (older projects) strands the plane was split into; planes now stay one piece. */
  strands?: number
  /** Gentle flowing wave even when standing still (0 = none … 1 = strong). */
  flutter?: number
  img: Img // texture, (w*k) x (h*k) texels where k = skin res / 64
}

export type HairInfo = Omit<HairPlane, 'img'>

/** Default smoothness per hair length (0 = snappy, 1 = slow and floaty). */
export const DEFAULT_FLOW: Record<HairLength, number> = { short: 0.35, medium: 0.55, long: 0.75 }
const LIMIT_OUT: Record<HairLength, number> = { short: 50, medium: 70, long: 85 }

/** All physics values from the single "smoothness" setting. */
export function physFromFlow(flow: number, length: HairLength): HairPhys {
  const f = Math.min(1, Math.max(0, flow))
  const r = (n: number) => Math.round(n * 1000) / 1000
  return {
    flow: r(f),
    stiffness: r(0.3 + (0.05 - 0.3) * f),
    damping: 0, // derived (critical) — kept for older projects
    gravity: r(0.6 + 0.3 * f),
    drag: r(1.6 + 1.4 * f),
    sway: r(0.5 + 0.5 * f),
    limitIn: 4,
    limitOut: LIMIT_OUT[length]
  }
}

export const LENGTH_PRESET: Record<HairLength, { h: number; segments: number; phys: HairPhys }> = {
  short: { h: 4, segments: 4, phys: physFromFlow(DEFAULT_FLOW.short, 'short') },
  medium: { h: 8, segments: 6, phys: physFromFlow(DEFAULT_FLOW.medium, 'medium') },
  long: { h: 14, segments: 9, phys: physFromFlow(DEFAULT_FLOW.long, 'long') }
}

export function hairDefaults(side: HairSide, length: HairLength): Omit<HairInfo, 'id' | 'name'> {
  const p = LENGTH_PRESET[length]
  return {
    visible: true,
    side,
    length,
    pos: side === 'front' ? [0, 8, 4.6] : [0, 8, -4.6],
    rot: [0, side === 'back' ? 180 : 0, 0],
    w: 8,
    h: p.h,
    segments: p.segments,
    phys: { ...p.phys }
  }
}

/** The hair-specific options with their defaults filled in. */
export function hairOpts(p: Pick<HairPlane, 'hang' | 'curl' | 'strands' | 'flutter'>) {
  return { hang: p.hang !== false, curl: p.curl ?? 0, strands: 1 /* planes stay one smooth piece: splitting them made the hair look torn */, flutter: 0 /* flowing hair was removed; old planes stop fluttering */ }
}

/**
 * Physics as it runs: with "hang" the hair keeps pointing down when the head bends (full
 * gravity, room to swing out), without it the hair moves with the head.
 */
export function livePhys(p: HairPhys, hang: boolean, belowHead = false): HairPhys {
  // gravity 1: the whole plane turns against the head's tilt at its top edge, so it keeps hanging
  // down; below the head it may also turn inwards (nothing to clip into there)
  return { ...p, gravity: hang ? 1 : 0, limitOut: Math.min(Math.max(p.limitOut, hang ? 60 : 0), 70), tiltIn: belowHead ? 90 : p.limitIn }
}

/** Each strand of a split plane gets its own rhythm and a slightly different speed, so they drift apart. */
export function strandVariation(i: number, n: number): { phase: number; jitter: number } {
  if (n <= 1) return { phase: 0, jitter: 0 }
  return { phase: (i * 2.39996) % (2 * Math.PI), jitter: (((i * 7) % 5) / 4) * 0.24 - 0.12 }
}

/** Largest sideways swing of a plane (rad, about 20°). */
export const MAX_ROLL = 0.35

/** Flutter wave: rad/s, travel between segments (rad), outward and sideways amplitude (rad). */
export const FLUTTER = { speed: 2.4, travel: 0.9, out: 0.35, roll: 0.18 }

export const hairTexSize = (w: number, h: number, res: number) => [Math.max(1, Math.round((w * res) / 64)), Math.max(1, Math.round((h * res) / 64))] as const

/**
 * Whether a plane starts on the head: its top is near the top of the head (y 5..9.5 above the
 * neck) and it sits on the head's surface (a side or the top), not inside it or away from it.
 * Planes hanging from the neck or floating inside the head look like a separate piece in game.
 */
export function hairAttached(p: Pick<HairPlane, 'pos' | 'side'>): boolean {
  const [x, y, z] = p.pos
  // near the head's surface: on a side (front, back, left, right) or on top, not inside or away
  const out = Math.max(Math.abs(x), Math.abs(z))
  return y >= 5 && y <= 9.5 && out <= 5.4 && (out >= 3.8 || y >= 7.8)
}

/** The default spot on the head for this side, keeping the sideways offset. */
export function attachedPos(p: Pick<HairPlane, 'pos' | 'side'>): [number, number, number] {
  return [Math.max(-4.5, Math.min(4.5, p.pos[0])), 8, p.side === 'front' ? 4.6 : -4.6]
}

/** Nearest-neighbour rescale to any size (used when a hair plane is resized). */
export function rescale(img: Img, w: number, h: number): Img {
  const out = createImg(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (Math.floor((y * img.h) / h) * img.w + Math.floor((x * img.w) / w)) * 4
      out.data.set(img.data.subarray(s, s + 4), (y * w + x) * 4)
    }
  return out
}

// ---- physics ---------------------------------------------------------------------------

/** Motion of the head for one tick, in body space (MC units: blocks/tick, radians). */
export interface Motion {
  vx: number // sideways velocity (+ = player's left)
  vy: number // vertical velocity (+ = up)
  vz: number // forward velocity (+ = forward)
  pitch: number // head pitch, + = looking down
  yawRate: number // head yaw change this tick (+ = turning left)
}

const D2R = Math.PI / 180
/** Each lower segment follows a little slower (stiffness x LAG per segment): a soft wave. */
export const LAG = 0.72
/**
 * How much of its swing each segment shows: the root stays close to the head (so the hair
 * never lifts off the scalp) and the tips move fully, which also curves the strand smoothly.
 */
/** The top segment stays put (pinned to the head); the swing grows down to the tip. */
export const ROOT = 0
export const rootWeight = (i: number, n: number) => (n <= 1 ? 0.6 : ROOT + (1 - ROOT) * (i / (n - 1)))

/**
 * Damping that makes a per-tick spring critically damped: it reaches its target as fast as
 * possible without ever bouncing past it. For v' = (v + (T - x)k)(1 - d), x' = x + v',
 * the double root is at 1 - d = 1 / (1 + sqrt(k))^2.
 */
export const criticalKeep = (k: number) => 1 / (1 + Math.sqrt(k)) ** 2

/**
 * Hair chain for one plane, stepped at 20 ticks/s and interpolated per frame. Each segment's
 * absolute angle is its own critically damped spring towards the same target (lower segments
 * a bit slower), so the chain bends smoothly and never wobbles. Segment rotations are the
 * differences between neighbours. Must stay in sync with src/figura/nkw_physics.lua.
 */
export class HairSim {
  /** relative (per-segment) angles, what the model applies */
  out: Float64Array
  roll: Float64Array
  private a: Float64Array // absolute outward angle per segment
  private r: Float64Array // absolute roll per segment
  private va: Float64Array
  private vr: Float64Array
  private pa: Float64Array
  private pr: Float64Array
  /** the head's tilt undone at the root (rad), now and one tick ago */
  private tilt = 0
  private ptilt = 0

  /** seconds of simulated time (drives the flutter wave) */
  private t = 0

  constructor(
    readonly segments: number,
    public side: HairSide,
    public phys: HairPhys,
    public extra: { flutter: number; phase: number; jitter: number } = { flutter: 0, phase: 0, jitter: 0 }
  ) {
    const n = segments
    this.out = new Float64Array(n)
    this.roll = new Float64Array(n)
    this.a = new Float64Array(n)
    this.r = new Float64Array(n)
    this.va = new Float64Array(n)
    this.vr = new Float64Array(n)
    this.pa = new Float64Array(n)
    this.pr = new Float64Array(n)
  }

  step(m: Motion) {
    const p = this.phys
    const s = this.side === 'front' ? 1 : -1
    // targets: drag from moving, lift from falling, keep hanging when the head tilts, sway on turns
    // the head's tilt is undone at once at the plane's root (it turns about its top edge, which stays
    // on the head); the springs only carry the swing from moving
    this.ptilt = this.tilt
    this.tilt = Math.max(-(p.tiltIn ?? p.limitIn) * D2R, Math.min(Math.PI / 2, s * m.pitch * p.gravity))
    const outTarget = -s * m.vz * p.drag + Math.max(0, -m.vy) * p.drag * 0.6
    const rollTarget = -m.vx * p.drag * 0.8 - m.yawRate * p.sway * 4
    const lo = -p.limitIn * D2R
    const hi = p.limitOut * D2R
    this.pa.set(this.a)
    this.pr.set(this.r)
    this.t += 1 / 20
    const { flutter, phase, jitter } = this.extra
    for (let i = 0; i < this.segments; i++) {
      const k = p.stiffness * (1 + jitter) * LAG ** i
      const keep = criticalKeep(k)
      // flowing wave travelling down the strand
      const wave = flutter ? flutter * Math.sin(this.t * FLUTTER.speed + phase - i * FLUTTER.travel) : 0
      this.va[i] = (this.va[i] + (outTarget + wave * FLUTTER.out - this.a[i]) * k) * keep
      this.vr[i] = (this.vr[i] + (rollTarget + wave * FLUTTER.roll - this.r[i]) * k) * keep
      this.a[i] += this.va[i]
      this.r[i] += this.vr[i]
      if (this.a[i] < lo) (this.a[i] = lo), (this.va[i] = 0)
      if (this.a[i] > hi) (this.a[i] = hi), (this.va[i] = 0)
      this.r[i] = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, this.r[i]))
    }
    const n = this.segments
    for (let i = 0; i < n; i++) {
      this.out[i] = this.a[i] * rootWeight(i, n) - (i ? this.a[i - 1] * rootWeight(i - 1, n) : 0) + (i ? 0 : this.tilt)
      // no sideways swing: rolling segments inside a flat plane tears its joints apart, and turning
      // the whole plane pulls its top edge off the head
      this.roll[i] = 0
    }
  }

  /** Interpolated relative angles between the previous and current tick (alpha 0..1). */
  sample(i: number, alpha: number): [number, number] {
    const n = this.segments
    const lerp = (prev: Float64Array, cur: Float64Array, j: number) => (j < 0 ? 0 : (prev[j] + (cur[j] - prev[j]) * alpha) * rootWeight(j, n))
    const tilt = i ? 0 : this.ptilt + (this.tilt - this.ptilt) * alpha
    return [lerp(this.pa, this.a, i) - lerp(this.pa, this.a, i - 1) + tilt, 0]
  }
}


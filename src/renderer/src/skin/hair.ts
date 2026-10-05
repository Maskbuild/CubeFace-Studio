import { createImg, type Img } from './pixels'

export type HairSide = 'front' | 'back'
export type HairLength = 'short' | 'medium' | 'long'

/** Physics tuning; the same numbers drive the in-app preview and the exported Lua (nkw_physics.lua). */
export interface HairPhys {
  stiffness: number // spring pull back to rest, per tick (0..1)
  damping: number // velocity loss per tick (0..1)
  gravity: number // how strongly segments keep hanging down when the head tilts (0..1)
  drag: number // swing from movement speed (rad per block/tick)
  sway: number // sideways swing from head turning (0..1)
  limitIn: number // max inward swing in degrees (towards the head; keeps bangs out of the face)
  limitOut: number // max outward swing in degrees
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
  presetId?: string // set when the plane came from a Figura preset (toggled as a group)
  img: Img // texture, (w*k) x (h*k) texels where k = skin res / 64
}

export type HairInfo = Omit<HairPlane, 'img'>

export const LENGTH_PRESET: Record<HairLength, { h: number; segments: number; phys: HairPhys }> = {
  short: { h: 4, segments: 2, phys: { stiffness: 0.32, damping: 0.32, gravity: 0.6, drag: 1.6, sway: 0.5, limitIn: 4, limitOut: 50 } },
  medium: { h: 8, segments: 3, phys: { stiffness: 0.22, damping: 0.26, gravity: 0.75, drag: 2.2, sway: 0.7, limitIn: 4, limitOut: 70 } },
  long: { h: 14, segments: 5, phys: { stiffness: 0.14, damping: 0.2, gravity: 0.85, drag: 2.8, sway: 0.9, limitIn: 4, limitOut: 85 } }
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

export const hairTexSize = (w: number, h: number, res: number) => [Math.max(1, Math.round((w * res) / 64)), Math.max(1, Math.round((h * res) / 64))] as const

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

/**
 * Spring chain for one hair plane, stepped at 20 ticks/s and interpolated per frame.
 * Each segment has an outward swing angle (about local X) and a side roll (about local Z).
 * Must stay in sync with src/figura/nkw_physics.lua.
 */
export class HairSim {
  out: Float64Array
  roll: Float64Array
  private vOut: Float64Array
  private vRoll: Float64Array
  private pOut: Float64Array
  private pRoll: Float64Array

  constructor(
    readonly segments: number,
    public side: HairSide,
    public phys: HairPhys
  ) {
    const n = segments
    this.out = new Float64Array(n)
    this.roll = new Float64Array(n)
    this.vOut = new Float64Array(n)
    this.vRoll = new Float64Array(n)
    this.pOut = new Float64Array(n)
    this.pRoll = new Float64Array(n)
  }

  step(m: Motion) {
    const p = this.phys
    const s = this.side === 'front' ? 1 : -1
    // world-space targets: drag from moving, lift from falling, keep hanging when the head tilts
    const outTarget = -s * m.vz * p.drag + Math.max(0, -m.vy) * p.drag * 0.6 + s * m.pitch * p.gravity
    const rollTarget = -m.vx * p.drag * 0.8 - m.yawRate * p.sway * 4
    const lo = -p.limitIn * D2R
    const hi = p.limitOut * D2R
    let parentOut = 0
    let parentRoll = 0
    this.pOut.set(this.out)
    this.pRoll.set(this.roll)
    for (let i = 0; i < this.segments; i++) {
      // angles are relative to the parent: spread what is still missing over the remaining
      // segments, so the chain curves smoothly and its tip ends up at the target
      const k = p.stiffness
      const share = 1 / (this.segments - i)
      const tOut = (outTarget - parentOut) * share
      const tRoll = (rollTarget - parentRoll) * share
      this.vOut[i] = (this.vOut[i] + (tOut - this.out[i]) * k) * (1 - p.damping)
      this.vRoll[i] = (this.vRoll[i] + (tRoll - this.roll[i]) * k) * (1 - p.damping)
      this.out[i] += this.vOut[i]
      this.roll[i] += this.vRoll[i]
      const total = parentOut + this.out[i]
      if (total < lo) (this.out[i] = lo - parentOut), (this.vOut[i] = 0)
      if (total > hi) (this.out[i] = hi - parentOut), (this.vOut[i] = 0)
      this.roll[i] = Math.max(-0.9, Math.min(0.9, this.roll[i]))
      parentOut += this.out[i]
      parentRoll += this.roll[i]
    }
  }

  /** Interpolated angles between the previous and current tick (alpha 0..1). */
  sample(i: number, alpha: number): [number, number] {
    return [this.pOut[i] + (this.out[i] - this.pOut[i]) * alpha, this.pRoll[i] + (this.roll[i] - this.pRoll[i]) * alpha]
  }
}

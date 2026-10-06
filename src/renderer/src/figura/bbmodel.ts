import * as THREE from 'three'
import { cuboids, type FaceName, type PartId, type Rect, type Variant } from '../skin/layout'
import { hairOpts, type HairInfo } from '../skin/hair'
import type { FaceFrame, FiguraConfig } from '../skin/figura'
import type { AtlasSlot } from './atlas'

/*
 * Blockbench "Generic model" (format 5) writer for Figura.
 * App space: front +Z, player's right -X.  Blockbench/Figura: front north (-Z), right +X.
 * So a point (x, y, z) maps to (-x, y, -z) and rotations (rx, ry, rz) to (-rx, ry, -rz).
 */

type V3 = [number, number, number]
const bb = (p: V3): V3 => [-p[0] + 0, p[1], -p[2] + 0] // "+ 0" turns -0 into 0 for clean JSON
const r4 = (n: number) => Math.round(n * 1e4) / 1e4 + 0

let uidN = 0
const uid = () => {
  const h = (uidN++).toString(16).padStart(12, '0')
  return `4e4b5700-0000-4000-8000-${h}`
}

type BBFace = { uv: number[]; texture: number | null }
interface BBCube {
  name: string
  type: 'cube'
  uuid: string
  from: V3
  to: V3
  origin: V3
  rotation?: V3
  inflate?: number
  box_uv: false
  faces: Record<'north' | 'east' | 'south' | 'west' | 'up' | 'down', BBFace>
}
interface BBGroup {
  name: string
  uuid: string
  origin: V3
  rotation: V3
  visibility: boolean
  export: boolean
  children: (BBGroup | string)[]
}

const NO_FACE: BBFace = { uv: [0, 0, 0, 0], texture: null }

/** Lua paths and settings the script generator needs. */
export interface ModelInfo {
  hairChains: { path: string[]; id: string; strand?: number; strands?: number }[]
  faceParts: Partial<Record<FaceFrame, string>>
  /** Vanilla parts this avatar replaces (Figura vanilla_model names). */
  replaces: string[]
  /** Atlas size and slots (wheel icons drawn from the avatar texture). */
  atlas: { w: number; h: number; slots: Record<string, AtlasSlot> }
  /** What glows (the glow texture is exported): eye plane, skin cubes (paths), hair plane ids. */
  glow?: { eyes: boolean; skin: boolean; hair: string[]; skinParts: string[] }
  /** Hair plane id -> its group under Head. */
  hairGroups?: Record<string, string>
}

export interface ModelInput {
  name: string
  variant: Variant
  res: number
  atlasW: number
  atlasH: number
  /** Width of the skin part of the atlas (the atlas is wider when face frames are more detailed). */
  skinW?: number
  atlasDataUrl: string
  /** Glow (emissive) texture with the same layout; Figura pairs "skin_e" with "skin". */
  glowDataUrl?: string
  /** Some skin layers glow (so the skin cubes get a glow switch). */
  glowSkin?: boolean
  slots: Record<string, AtlasSlot>
  hair: HairInfo[]
  figura: FiguraConfig
  faceFrames: FaceFrame[]
  /** Eyes / mouth are painted on the hat: frames (except the base one) go in front of the hat, at its size. */
  faceOnHat?: boolean
  /** Which cuboids (layout order) have visible pixels; unused ones are not exported. */
  used?: boolean[]
}

const PIVOT: Record<PartId, V3> = { head: [0, 24, 0], body: [0, 24, 0], rightArm: [-5, 22, 0], leftArm: [5, 22, 0], rightLeg: [-2, 12, 0], leftLeg: [2, 12, 0] }
const VANILLA: Record<PartId, string[]> = {
  head: ['HEAD', 'HAT'],
  body: ['BODY', 'JACKET'],
  rightArm: ['RIGHT_ARM', 'RIGHT_SLEEVE'],
  leftArm: ['LEFT_ARM', 'LEFT_SLEEVE'],
  rightLeg: ['RIGHT_LEG', 'RIGHT_PANTS'],
  leftLeg: ['LEFT_LEG', 'LEFT_PANTS']
}
const GROUP: Record<PartId, string> = { head: 'Head', body: 'Body', rightArm: 'RightArm', leftArm: 'LeftArm', rightLeg: 'RightLeg', leftLeg: 'LeftLeg' }

/** App-space Euler (degrees, order YXZ as used by the editor) -> Blockbench Euler (ZYX). */
export function toBBRotation(rot: V3): V3 {
  const D = Math.PI / 180
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * D, rot[1] * D, rot[2] * D, 'YXZ'))
  // conjugate by a 180° turn about Y: negate the x and z components
  const qb = new THREE.Quaternion(-q.x, q.y, -q.z, q.w)
  const e = new THREE.Euler().setFromQuaternion(qb, 'ZYX')
  return [r4(e.x / D), r4(e.y / D), r4(e.z / D)]
}

export function buildModel(inp: ModelInput): { model: object; info: ModelInfo } {
  uidN = 0
  const k = 64 / inp.atlasW // atlas pixels -> UV units (UV space is 64 wide)
  const elements: BBCube[] = []
  const groups: BBGroup[] = []
  const info: ModelInfo = { hairChains: [], faceParts: {}, replaces: [], atlas: { w: inp.atlasW, h: inp.atlasH, slots: inp.slots } }

  const group = (name: string, origin: V3, rotation: V3 = [0, 0, 0]): BBGroup => {
    const g = { name, uuid: uid(), origin, rotation, visibility: true, export: true, children: [] }
    groups.push(g)
    return g
  }
  const cube = (parent: BBGroup, c: Omit<BBCube, 'uuid' | 'type' | 'box_uv'>) => {
    const el: BBCube = { ...c, uuid: uid(), type: 'cube', box_uv: false }
    elements.push(el)
    parent.children.push(el.uuid)
    return el
  }
  const slotUV = (s: AtlasSlot, sub?: Rect): number[] => {
    const r = sub ? { x: s.x + sub.x, y: s.y + sub.y, w: sub.w, h: sub.h } : s
    return [r4(r.x * k), r4(r.y * k), r4((r.x + r.w) * k), r4((r.y + r.h) * k)]
  }
  /**
   * A flat plane facing north (front), one face only: Figura draws it from both sides (no culling),
   * and a second face at the same spot z-fights (flickering stripes on hair and eyes in game).
   */
  const plane = (parent: BBGroup, name: string, x0: number, x1: number, y0: number, y1: number, z: number, uv: number[]) =>
    cube(parent, {
      name,
      from: [r4(Math.min(x0, x1)), r4(y0), r4(z)],
      to: [r4(Math.max(x0, x1)), r4(y1), r4(z)],
      origin: [0, 0, 0],
      faces: { north: { uv, texture: 0 }, south: NO_FACE, east: NO_FACE, west: NO_FACE, up: NO_FACE, down: NO_FACE }
    })

  // ---- player body ----------------------------------------------------------------------
  const parts = {} as Record<PartId, BBGroup>
  for (const p of Object.keys(GROUP) as PartId[]) parts[p] = group(GROUP[p], bb(PIVOT[p]))
  const roots: BBGroup[] = Object.values(parts)
  const skinPaths: string[] = []

  cuboids(inp.variant).forEach((c, ci) => {
    if (inp.used && !inp.used[ci]) return
    info.replaces.push(...VANILLA[c.part])
    const lo: V3 = c.min
    const hi: V3 = [c.min[0] + c.size[0], c.min[1] + c.size[1], c.min[2] + c.size[2]]
    const f = (n: FaceName) => c.faces.find((x) => x.name === n)!.rect
    // skin rects are in the 64-unit UV space of the skin; top/bottom are flipped in Blockbench
    const sk = (inp.skinW ?? inp.atlasW) / inp.atlasW
    const uv = (r0: Rect, flip?: 'up' | 'down'): number[] => {
      const r = sk === 1 ? r0 : { x: r4(r0.x * sk), y: r4(r0.y * sk), w: r4(r0.w * sk), h: r4(r0.h * sk) }
      if (flip === 'up') return [r.x + r.w, r.y + r.h, r.x, r.y]
      if (flip === 'down') return [r.x + r.w, r.y, r.x, r.y + r.h]
      return [r.x, r.y, r.x + r.w, r.y + r.h]
    }
    const cubeName = (GROUP[c.part] + (c.kind === 'overlay' ? 'Layer' : '')).replace('HeadLayer', 'Hat')
    skinPaths.push(`${GROUP[c.part]}.${cubeName}`)
    cube(parts[c.part], {
      name: cubeName,
      from: [-hi[0], lo[1], -hi[2]],
      to: [-lo[0], hi[1], -lo[2]],
      origin: bb(PIVOT[c.part]),
      inflate: c.inflate || undefined,
      faces: {
        north: { uv: uv(f('front')), texture: 0 },
        east: { uv: uv(f('right')), texture: 0 },
        south: { uv: uv(f('back')), texture: 0 },
        west: { uv: uv(f('left')), texture: 0 },
        up: { uv: uv(f('top'), 'up'), texture: 0 },
        down: { uv: uv(f('bottom'), 'down'), texture: 0 }
      }
    })
  })
  info.replaces = [...new Set(info.replaces)]

  // ---- face planes (in front of the face, behind the hat layer) --------------------------
  const head = parts.head
  const faceGroup = group('Face', [0, 24, 0])
  head.children.push(faceGroup)
  // the base frame replaces the skin face (under the hat); the others sit on the face, or in front
  // of the hat (scaled to the hat, 9/8) when the eyes and mouth are painted on the hat
  const onHat = !!inp.faceOnHat
  const front = (fr: FaceFrame, i: number) => (onHat && fr !== 'base' ? { a: -4.5, b: 4.5, y0: 23.5, y1: 32.5, z: r4(-4.52 - i * 0.01) } : { a: -4, b: 4, y0: 24, y1: 32, z: r4(-4.02 - i * 0.01) })
  inp.faceFrames.forEach((fr, i) => {
    const s = inp.slots[`face_${fr}`]
    if (!s) return
    const name = 'F_' + fr
    const q = front(fr, i)
    plane(faceGroup, name, q.a, q.b, q.y0, q.y1, q.z, slotUV(s))
    info.faceParts[fr] = name
  })
  // glowing eyes: the eye spots on their own plane just in front of the face (or the hat)
  const eyeSlot = inp.slots.eyes_glow
  if (eyeSlot) {
    const q = onHat ? { a: -4.5, b: 4.5, y0: 23.5, y1: 32.5, z: -4.525 } : { a: -4, b: 4, y0: 24, y1: 32, z: -4.025 }
    plane(faceGroup, 'GlowEyes', q.a, q.b, q.y0, q.y1, q.z, slotUV(eyeSlot))
  }
  const glowLayers = !!inp.glowDataUrl
  info.glow = glowLayers ? { eyes: !!eyeSlot, skin: inp.glowSkin ?? false, hair: [], skinParts: [] } : undefined
  // ---- hair planes: one chain per strand (a plane can be split into strands that swing apart) ----
  inp.hair.forEach((h, hi) => {
    const s = inp.slots['hair_' + h.id]
    if (!s || !h.visible) return
    const o = hairOpts(h)
    const len = h.h / h.segments
    const top: V3 = bb([h.pos[0], h.pos[1] + 24, h.pos[2]])
    const name = `Hair${hi + 1}`
    const container = group(name, top, toBBRotation(h.rot))
    head.children.push(container)
    // rest curve per segment, in the same direction the physics swings outward
    const curl = r4((o.curl / h.segments) * inp.figura.swingAxis)
    const sw = h.w / o.strands
    const tw = s.w / o.strands
    for (let j = 0; j < o.strands; j++) {
      // strand centre in head space (x mirrors into Blockbench space)
      const cx = r4(top[0] - (-h.w / 2 + (j + 0.5) * sw))
      let parent = container
      const strandName = o.strands > 1 ? `st${j + 1}` : ''
      if (strandName) {
        const sg = group(strandName, [cx, top[1], top[2]])
        container.children.push(sg)
        parent = sg
      }
      const path: string[] = strandName ? [strandName] : []
      for (let i = 0; i < h.segments; i++) {
        const seg = group('s' + (i + 1), [cx, r4(top[1] - i * len), top[2]], [curl, 0, 0])
        parent.children.push(seg)
        const segH = s.h / h.segments
        plane(seg, `${name}_${strandName ? strandName + '_' : ''}${i + 1}`, cx - sw / 2, cx + sw / 2, r4(top[1] - (i + 1) * len), r4(top[1] - i * len), top[2], slotUV(s, { x: j * tw, y: i * segH, w: tw, h: segH }))
        path.push('s' + (i + 1))
        parent = seg
      }
      info.hairChains.push({ path: [name, ...path], id: h.id, strand: j, strands: o.strands })
    }
    if (h.glow && info.glow) info.glow.hair.push(h.id)
    ;(info.hairGroups ??= {})[h.id] = name
  })

  if (info.glow?.skin) info.glow.skinParts = skinPaths
  const outline = (g: BBGroup): object => ({ uuid: g.uuid, isOpen: false, children: g.children.map((c) => (typeof c === 'string' ? c : outline(c))) })
  const model = {
    meta: { format_version: '5.0', model_format: 'free', box_uv: false },
    name: inp.name,
    model_identifier: '',
    visible_box: [1, 1, 0],
    resolution: { width: 64, height: r4(64 * (inp.atlasH / inp.atlasW)) },
    elements,
    groups: groups.filter((g) => !roots.includes(g) || g.children.length).map(({ children: _c, ...g }) => ({ ...g, isOpen: false })),
    // part groups left empty (an unused limb) are dropped entirely
    outliner: roots.filter((g) => g.children.length).map(outline),
    textures: [
      {
        name: 'skin.png',
        id: '0',
        width: inp.atlasW,
        height: inp.atlasH,
        uv_width: 64,
        uv_height: r4(64 * (inp.atlasH / inp.atlasW)),
        particle: false,
        render_mode: 'default',
        render_sides: 'auto',
        mode: 'bitmap',
        saved: true,
        uuid: uid(),
        source: inp.atlasDataUrl
      },
      ...(inp.glowDataUrl
        ? [
            {
              name: 'skin_e.png',
              id: '1',
              width: inp.atlasW,
              height: inp.atlasH,
              uv_width: 64,
              uv_height: r4(64 * (inp.atlasH / inp.atlasW)),
              particle: false,
              render_mode: 'emissive',
              render_sides: 'auto',
              mode: 'bitmap',
              saved: true,
              uuid: uid(),
              source: inp.glowDataUrl
            }
          ]
        : [])
    ]
  }
  return { model, info }
}

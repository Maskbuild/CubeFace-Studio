// Minecraft player skin layout (64x64 base units). Higher resolutions scale every rect by res/64.
// Model space is in skin pixels: feet at y=0, the player faces +Z, so the player's right side is -X.

export type Variant = 'wide' | 'slim'
export type FaceName = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back'
export type PartId = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg'
export type LayerKind = 'base' | 'overlay'

export const RESOLUTIONS = [64, 128, 256, 512, 1024, 2048] as const
export type Resolution = (typeof RESOLUTIONS)[number]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface FaceDef {
  name: FaceName
  rect: Rect
}

export interface CuboidDef {
  key: string // e.g. "head.base"
  part: PartId
  kind: LayerKind
  min: [number, number, number]
  size: [number, number, number]
  inflate: number
  faces: FaceDef[]
}

export const PARTS: PartId[] = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']
export const FACE_NAMES: FaceName[] = ['top', 'bottom', 'right', 'front', 'left', 'back']

/** Standard Minecraft box-UV unwrap for a w*h*d box whose texture starts at (u, v). */
export function boxFaces(u: number, v: number, w: number, h: number, d: number): FaceDef[] {
  return [
    { name: 'top', rect: { x: u + d, y: v, w, h: d } },
    { name: 'bottom', rect: { x: u + d + w, y: v, w, h: d } },
    { name: 'right', rect: { x: u, y: v + d, w: d, h } },
    { name: 'front', rect: { x: u + d, y: v + d, w, h } },
    { name: 'left', rect: { x: u + d + w, y: v + d, w: d, h } },
    { name: 'back', rect: { x: u + 2 * d + w, y: v + d, w, h } }
  ]
}

interface PartSpec {
  part: PartId
  min: [number, number, number]
  size: [number, number, number]
  base: [number, number]
  overlay: [number, number]
  inflate: number
}

function partSpecs(variant: Variant): PartSpec[] {
  const aw = variant === 'slim' ? 3 : 4
  return [
    { part: 'head', min: [-4, 24, -4], size: [8, 8, 8], base: [0, 0], overlay: [32, 0], inflate: 0.5 },
    { part: 'body', min: [-4, 12, -2], size: [8, 12, 4], base: [16, 16], overlay: [16, 32], inflate: 0.25 },
    { part: 'rightArm', min: [-4 - aw, 12, -2], size: [aw, 12, 4], base: [40, 16], overlay: [40, 32], inflate: 0.25 },
    { part: 'leftArm', min: [4, 12, -2], size: [aw, 12, 4], base: [32, 48], overlay: [48, 48], inflate: 0.25 },
    { part: 'rightLeg', min: [-4, 0, -2], size: [4, 12, 4], base: [0, 16], overlay: [0, 32], inflate: 0.25 },
    { part: 'leftLeg', min: [0, 0, -2], size: [4, 12, 4], base: [16, 48], overlay: [0, 48], inflate: 0.25 }
  ]
}

const cache = new Map<Variant, CuboidDef[]>()

export function cuboids(variant: Variant): CuboidDef[] {
  let list = cache.get(variant)
  if (list) return list
  list = []
  for (const s of partSpecs(variant)) {
    const [w, h, d] = s.size
    for (const kind of ['base', 'overlay'] as LayerKind[]) {
      const [u, v] = kind === 'base' ? s.base : s.overlay
      list.push({
        key: `${s.part}.${kind}`,
        part: s.part,
        kind,
        min: s.min,
        size: s.size,
        inflate: kind === 'base' ? 0 : s.inflate,
        faces: boxFaces(u, v, w, h, d)
      })
    }
  }
  cache.set(variant, list)
  return list
}

export interface FaceRef {
  cuboid: number
  face: number
}

const faceMapCache = new Map<Variant, Int16Array>()

/** 64x64 lookup: base pixel -> (cuboidIndex * 6 + faceIndex), or -1 when unused. */
export function faceMap(variant: Variant): Int16Array {
  let map = faceMapCache.get(variant)
  if (map) return map
  map = new Int16Array(64 * 64).fill(-1)
  cuboids(variant).forEach((c, ci) =>
    c.faces.forEach((f, fi) => {
      const { x, y, w, h } = f.rect
      for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) map![py * 64 + px] = ci * 6 + fi
    })
  )
  faceMapCache.set(variant, map)
  return map
}

/** Which cuboid face contains texel (x, y) at the given resolution. */
export function faceAt(variant: Variant, res: number, x: number, y: number): FaceRef | null {
  if (x < 0 || y < 0 || x >= res || y >= res) return null
  const k = res / 64
  const v = faceMap(variant)[Math.floor(y / k) * 64 + Math.floor(x / k)]
  return v < 0 ? null : { cuboid: Math.floor(v / 6), face: v % 6 }
}

export function scaleRect(r: Rect, res: number): Rect {
  const k = res / 64
  return { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k }
}

export function faceRect(variant: Variant, res: number, ref: FaceRef): Rect {
  return scaleRect(cuboids(variant)[ref.cuboid].faces[ref.face].rect, res)
}

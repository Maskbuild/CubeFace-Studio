import { cuboids, faceAt, faceRect, type FaceName, type PartId, type Variant } from './layout'

const PART_MIRROR: Record<PartId, PartId> = {
  head: 'head',
  body: 'body',
  rightArm: 'leftArm',
  leftArm: 'rightArm',
  rightLeg: 'leftLeg',
  leftLeg: 'rightLeg'
}

const FACE_MIRROR: Record<FaceName, FaceName> = {
  top: 'top',
  bottom: 'bottom',
  front: 'front',
  back: 'back',
  right: 'left',
  left: 'right'
}

/**
 * Mirror a texel across the model's X axis (left <-> right). Every face's horizontal texture
 * axis flips under X-mirroring while the vertical axis stays, so the mirrored texel is the
 * horizontally flipped position inside the mirrored face.
 */
export function mirrorTexel(variant: Variant, res: number, x: number, y: number): [number, number] | null {
  const ref = faceAt(variant, res, x, y)
  if (!ref) return null
  const list = cuboids(variant)
  const src = list[ref.cuboid]
  const srcFace = src.faces[ref.face]
  const ci = list.findIndex((c) => c.part === PART_MIRROR[src.part] && c.kind === src.kind)
  const fi = list[ci].faces.findIndex((f) => f.name === FACE_MIRROR[srcFace.name])
  const a = faceRect(variant, res, ref)
  const b = faceRect(variant, res, { cuboid: ci, face: fi })
  return [b.x + (a.w - 1 - (x - a.x)), b.y + (y - a.y)]
}

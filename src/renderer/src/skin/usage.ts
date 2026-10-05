import { cuboids, scaleRect, type PartId, type Variant } from './layout'
import type { Img } from './pixels'

/** For each cuboid (layout order): does any of its faces have a visible pixel? */
export function usedCuboids(img: Img, variant: Variant): boolean[] {
  const res = img.w
  return cuboids(variant).map((c) =>
    c.faces.some((f) => {
      const r = scaleRect(f.rect, res)
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) if (img.data[(y * res + x) * 4 + 3] > 0) return true
      return false
    })
  )
}

export function usedParts(img: Img, variant: Variant): Set<PartId> {
  const used = usedCuboids(img, variant)
  return new Set(cuboids(variant).filter((_, i) => used[i]).map((c) => c.part))
}

/**
 * Rows of the skin texture actually referenced by used faces (from the top), so a head-only
 * skin can ship a quarter-height texture. Returned in texels, rounded up to a multiple of 4 base px.
 */
export function usedHeight(img: Img, variant: Variant): number {
  const used = usedCuboids(img, variant)
  let maxY = 0
  cuboids(variant).forEach((c, i) => {
    if (!used[i]) return
    for (const f of c.faces) maxY = Math.max(maxY, f.rect.y + f.rect.h)
  })
  const k = img.w / 64
  return Math.max(4, Math.ceil(maxY / 4) * 4) * k
}

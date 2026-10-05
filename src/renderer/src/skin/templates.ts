import { cuboids, scaleRect, type FaceName, type Variant } from './layout'
import { createImg, fillRect, type Img, type RGBA } from './pixels'
import { mirrorTexel } from './mirror'

const SHADE: Record<FaceName, number> = { top: 1.08, front: 1, right: 0.9, left: 0.9, back: 0.82, bottom: 0.72 }

/** A plain grey mannequin so new skins show the model's shape before any painting. */
export function mannequin(res: number, variant: Variant): Img {
  const img = createImg(res, res)
  const tone: Record<string, number> = { head: 196, body: 150, rightArm: 170, leftArm: 170, rightLeg: 120, leftLeg: 120 }
  for (const c of cuboids(variant)) {
    if (c.kind !== 'base') continue
    for (const f of c.faces) {
      const v = Math.min(255, tone[c.part] * SHADE[f.name])
      fillRect(img, scaleRect(f.rect, res), [v, v, v, 255], 1)
    }
  }
  // simple eyes so front/back is obvious
  const k = res / 64
  const eye: RGBA = [60, 60, 70, 255]
  fillRect(img, { x: 9 * k, y: 12 * k, w: k, h: k }, eye, 1)
  fillRect(img, { x: 14 * k, y: 12 * k, w: k, h: k }, eye, 1)
  return img
}

/**
 * Convert a legacy 64x32 skin to 64x64: the left arm/leg (absent in the old format) are the
 * mirrored right arm/leg, exactly as the game does when it loads an old skin.
 */
export function upgradeLegacy(src: Img): Img {
  const res = src.w
  const out = createImg(res, res)
  out.data.set(src.data)
  for (const c of cuboids('wide')) {
    if (c.kind !== 'base' || (c.part !== 'rightArm' && c.part !== 'rightLeg')) continue
    for (const f of c.faces) {
      const r = scaleRect(f.rect, res)
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) {
          const m = mirrorTexel('wide', res, x, y)!
          const s = (y * res + x) * 4
          out.data.set(src.data.subarray(s, s + 4), (m[1] * res + m[0]) * 4)
        }
    }
  }
  return out
}

/** Slim skins leave the last 2 columns of the right arm's back face unused (x 54-55, y 20-31). */
export function detectVariant(img: Img): Variant {
  const k = img.w / 64
  for (let y = 20 * k; y < 32 * k; y++)
    for (let x = 54 * k; x < 56 * k; x++) if (img.data[(y * img.w + x) * 4 + 3] > 0) return 'wide'
  return 'slim'
}

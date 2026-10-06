import { over, type Img, type RGBA } from './pixels'
import type { Rect } from './layout'

/*
 * Cartoon face effects stamped onto a face frame: blush, sweat drop, anger mark, sparkle,
 * tears, gloom lines, heart, eye shine. Patterns are tiny pixel grids (one cell = one pixel of
 * a 64×64 skin) and grow with the skin resolution so they stay chunky like the skin.
 */

export const EFFECTS = ['blush', 'sweat', 'anger', 'sparkle', 'tears', 'gloom', 'heart', 'shine'] as const
export type FaceEffect = (typeof EFFECTS)[number]

const C: Record<string, RGBA> = {
  p: [255, 143, 177, 200], // blush pink
  b: [127, 211, 255, 255], // water blue
  c: [200, 240, 255, 255], // water highlight
  w: [255, 255, 255, 255],
  y: [255, 236, 140, 255],
  r: [255, 74, 90, 255],
  g: [91, 74, 138, 200] // gloom purple
}

const PATTERNS: Record<FaceEffect, string[]> = {
  blush: ['.p.p', 'p.p.'],
  sweat: ['.b.', 'bbb', 'bcb', '.b.'],
  anger: ['.r.r.', 'rr.rr', '.....', 'rr.rr', '.r.r.'],
  sparkle: ['.y.', 'ywy', '.y.'],
  tears: ['b', 'c', 'b', 'c'],
  gloom: ['g.g.g', 'g.g.g', '..g..'],
  heart: ['rr.rr', 'rrrrr', '.rrr.', '..r..'],
  shine: ['w']
}

export const effectSize = (e: FaceEffect) => ({ w: PATTERNS[e][0].length, h: PATTERNS[e].length })

/** Draw an effect centred on (cx, cy); `unit` texels per cell. Returns the area touched. */
export function stampEffect(img: Img, e: FaceEffect, cx: number, cy: number, unit: number): Rect | null {
  const rows = PATTERNS[e]
  const w = rows[0].length * unit, h = rows.length * unit
  const x0 = Math.round(cx - w / 2 + 0.5), y0 = Math.round(cy - h / 2 + 0.5)
  let any = false
  rows.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      const col = C[ch]
      if (!col) return
      for (let y = 0; y < unit; y++)
        for (let x = 0; x < unit; x++) {
          const px = x0 + i * unit + x, py = y0 + j * unit + y
          if (px < 0 || py < 0 || px >= img.w || py >= img.h) continue
          over(img.data, (py * img.w + px) * 4, col[0], col[1], col[2], col[3] / 255)
          any = true
        }
    })
  )
  if (!any) return null
  const x = Math.max(0, x0), y = Math.max(0, y0)
  return { x, y, w: Math.min(img.w, x0 + w) - x, h: Math.min(img.h, y0 + h) - y }
}

/** A small preview of an effect as a data URL (for the buttons). */
export function effectPreview(e: FaceEffect): string {
  const { w, h } = effectSize(e)
  const s = 6
  const c = document.createElement('canvas')
  c.width = c.height = 6 * s
  const g = c.getContext('2d')!
  const ox = Math.floor((6 - w) / 2) * s, oy = Math.floor((6 - h) / 2) * s
  PATTERNS[e].forEach((row, j) =>
    [...row].forEach((ch, i) => {
      const col = C[ch]
      if (!col) return
      g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${col[3] / 255})`
      g.fillRect(ox + i * s, oy + j * s, s, s)
    })
  )
  return c.toDataURL()
}

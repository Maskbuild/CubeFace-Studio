import { hsvToRgb, parseHex, rgbToHsv } from './color'
import { createImg, type Img } from './pixels'

/**
 * Colour adjustment for wardrobe items.
 * - 'hsv': shift hue, scale saturation, add brightness — keeps the original shading.
 * - 'gradient': map each pixel's brightness onto a shadow→highlight gradient, which recolours
 *   anything (even grey or black items) while keeping its shading smooth.
 */
export type Adjust =
  | { mode: 'none' }
  | { mode: 'hsv'; hue: number; sat: number; light: number } // hue -180..180, sat 0..2, light -1..1
  | { mode: 'gradient'; dark: string; light: string; mix: number } // mix 0..1

export const NO_ADJUST: Adjust = { mode: 'none' }

export function applyAdjust(src: Img, a: Adjust): Img {
  if (a.mode === 'none') return src
  const out = createImg(src.w, src.h)
  const s = src.data, d = out.data
  const dark = a.mode === 'gradient' ? parseHex(a.dark) ?? [0, 0, 0, 255] : null
  const light = a.mode === 'gradient' ? parseHex(a.light) ?? [255, 255, 255, 255] : null
  for (let i = 0; i < s.length; i += 4) {
    d[i + 3] = s[i + 3]
    if (s[i + 3] === 0) continue
    if (a.mode === 'hsv') {
      const [h, sa, v] = rgbToHsv(s[i], s[i + 1], s[i + 2])
      const [r, g, b] = hsvToRgb((((h + a.hue) % 360) + 360) % 360, Math.min(1, sa * a.sat), Math.max(0, Math.min(1, v + a.light)))
      d[i] = r
      d[i + 1] = g
      d[i + 2] = b
    } else {
      const lum = (s[i] * 0.299 + s[i + 1] * 0.587 + s[i + 2] * 0.114) / 255
      for (let c = 0; c < 3; c++) {
        const mapped = dark![c] + (light![c] - dark![c]) * lum
        d[i + c] = s[i + c] + (mapped - s[i + c]) * a.mix
      }
    }
  }
  return out
}

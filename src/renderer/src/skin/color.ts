import type { RGBA } from './pixels'

export function toHex([r, g, b, a]: RGBA, withAlpha = a < 255): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  return '#' + h(r) + h(g) + h(b) + (withAlpha ? h(a) : '')
}

export function parseHex(s: string): RGBA | null {
  let t = s.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3,4}$/i.test(t)) t = [...t].map((c) => c + c).join('')
  if (!/^([0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return null
  const n = (i: number) => parseInt(t.slice(i, i + 2), 16)
  return [n(0), n(2), n(4), t.length === 8 ? n(6) : 255]
}

/** h 0..360, s/v 0..1 */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255
  }
  return [f(5), f(3), f(1)]
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max ? d / max : 0, max]
}

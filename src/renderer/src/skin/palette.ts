import type { Img } from './pixels'

export interface Palette {
  id: string
  name: string
  colors: string[] // #rrggbb
  builtin?: boolean
}

export const BUILTIN_PALETTES: Palette[] = [
  {
    id: 'skin-tones',
    name: 'Skin tones',
    builtin: true,
    colors: ['#ffe0cf', '#fcd2b6', '#f5c19e', '#eab08a', '#dc9a72', '#c98760', '#b5744f', '#9c5f3f', '#824c31', '#6a3c27', '#53301f', '#3d2418']
  },
  {
    id: 'hair',
    name: 'Hair',
    builtin: true,
    colors: ['#1b1b1f', '#2e2626', '#4a3428', '#6b4a33', '#8f6845', '#b98d5c', '#e0c08a', '#f4e2b8', '#c0c3c8', '#f2f2f2', '#b0303a', '#e06a8c', '#7a5cd0', '#3d6fd8', '#33a5a0', '#4caf50']
  },
  {
    id: 'pastel',
    name: 'Pastel',
    builtin: true,
    colors: ['#ffd1dc', '#ffb3c6', '#ffc8a2', '#fde4a3', '#fff5ba', '#d4f0c0', '#b5ead7', '#a0e7e5', '#b4d8ff', '#c7ceea', '#e0bbe4', '#f6dfeb']
  },
  {
    id: 'wool',
    name: 'Minecraft wool',
    builtin: true,
    colors: ['#e9ecec', '#f07613', '#bd44b3', '#3aafd9', '#f8c627', '#70b919', '#ed8dac', '#3e4447', '#8e8e86', '#158991', '#792aac', '#35399d', '#724728', '#546d1b', '#a12722', '#141519']
  },
  {
    id: 'greys',
    name: 'Greys',
    builtin: true,
    colors: ['#000000', '#1a1a1a', '#333333', '#4d4d4d', '#666666', '#808080', '#999999', '#b3b3b3', '#cccccc', '#e6e6e6', '#ffffff']
  }
]

/** Median-cut quantisation of the opaque pixels of an image into at most `count` colours. */
export function extractPalette(img: Img, count = 16): string[] {
  const px: [number, number, number][] = []
  const step = Math.max(1, Math.floor((img.w * img.h) / 40000))
  for (let i = 0; i < img.w * img.h; i += step) {
    const o = i * 4
    if (img.data[o + 3] >= 128) px.push([img.data[o], img.data[o + 1], img.data[o + 2]])
  }
  if (!px.length) return []
  let boxes = [px]
  while (boxes.length < count) {
    let bi = -1, bestRange = 0, ch = 0
    boxes.forEach((b, i) => {
      if (b.length < 2) return
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0
        for (const p of b) {
          lo = Math.min(lo, p[c])
          hi = Math.max(hi, p[c])
        }
        if (hi - lo > bestRange) [bestRange, bi, ch] = [hi - lo, i, c]
      }
    })
    if (bi < 0) break
    const b = boxes[bi].sort((p, q) => p[ch] - q[ch])
    const mid = b.length >> 1
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid))
  }
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  const colors = boxes.map((b) => {
    const s = [0, 0, 0]
    for (const p of b) for (let c = 0; c < 3; c++) s[c] += p[c]
    return '#' + s.map((v) => hex(v / b.length)).join('')
  })
  // sort by luminance for a tidy swatch row
  const lum = (h: string) => parseInt(h.slice(1, 3), 16) * 0.3 + parseInt(h.slice(3, 5), 16) * 0.59 + parseInt(h.slice(5, 7), 16) * 0.11
  return [...new Set(colors)].sort((a, b) => lum(a) - lum(b))
}

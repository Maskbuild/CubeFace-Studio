import type { Rect } from './layout'

export type RGBA = [number, number, number, number] // 0-255 each

export interface Img {
  w: number
  h: number
  data: Uint8ClampedArray<ArrayBuffer>
}

export const createImg = (w: number, h: number): Img => ({ w, h, data: new Uint8ClampedArray(w * h * 4) })

export const cloneImg = (img: Img): Img => ({ w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) })

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export function clipRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, r.x)
  const y0 = Math.max(0, r.y)
  const x1 = Math.min(w, r.x + r.w)
  const y1 = Math.min(h, r.y + r.h)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

/** Copy a rect out of an image (used for undo patches). */
export function readRect(img: Img, r: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.w * r.h * 4)
  for (let y = 0; y < r.h; y++) {
    const s = ((r.y + y) * img.w + r.x) * 4
    out.set(img.data.subarray(s, s + r.w * 4), y * r.w * 4)
  }
  return out
}

export function writeRect(img: Img, r: Rect, src: Uint8ClampedArray) {
  for (let y = 0; y < r.h; y++) img.data.set(src.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((r.y + y) * img.w + r.x) * 4)
}

/** Non-premultiplied source-over of colour (r,g,b) with alpha `a` (0..1) onto pixel i. */
function over(d: Uint8ClampedArray, i: number, r: number, g: number, b: number, a: number) {
  const da = d[i + 3] / 255
  const oa = a + da * (1 - a)
  if (oa <= 0) {
    d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0
    return
  }
  const k = (da * (1 - a)) / oa
  const s = a / oa
  d[i] = r * s + d[i] * k
  d[i + 1] = g * s + d[i + 1] * k
  d[i + 2] = b * s + d[i + 2] * k
  d[i + 3] = oa * 255
}

export interface BrushOpts {
  size: number // diameter in texels
  softness: number // 0 hard .. 1 fully feathered
  shape: 'circle' | 'square'
}

/** Per-texel coverage (0..1) of a brush stamp, relative to the stamp's top-left offset. */
export function brushKernel({ size, softness, shape }: BrushOpts): { off: number; n: number; a: Float32Array } {
  const n = Math.max(1, Math.round(size))
  const off = -Math.floor(n / 2)
  const a = new Float32Array(n * n)
  const c = (n - 1) / 2
  const r = n / 2
  const hard = r * (1 - softness)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = shape === 'square' ? Math.max(Math.abs(x - c), Math.abs(y - c)) : Math.hypot(x - c, y - c)
      if (n > 2 && shape === 'circle' && d > r) continue
      let v = 1
      if (softness > 0 && d > hard) v = Math.max(0, 1 - (d - hard) / (r + 0.5 - hard))
      a[y * n + x] = v
    }
  return { off, n, a }
}

/**
 * Stroke state. Coverage is accumulated with max() into `mask`, then applied once against the
 * pre-stroke snapshot, so overlapping stamps inside one stroke never darken past the opacity.
 */
export class Stroke {
  mask: Float32Array
  dirty: Rect | null = null
  constructor(
    readonly target: Img,
    readonly snapshot: Img,
    readonly color: RGBA,
    readonly opacity: number,
    readonly mode: 'paint' | 'erase'
  ) {
    this.mask = new Float32Array(target.w * target.h)
  }

  /** Raise coverage at one texel; returns false if outside the image. */
  cover(x: number, y: number, v: number): boolean {
    const { w, h } = this.target
    if (x < 0 || y < 0 || x >= w || y >= h || v <= 0) return false
    const i = y * w + x
    if (v > this.mask[i]) {
      this.mask[i] = v
      this.dirty = unionRect(this.dirty, { x, y, w: 1, h: 1 })
    }
    return true
  }

  /** Re-render target pixels inside rect from snapshot + mask. */
  apply(r: Rect) {
    const { w } = this.target
    const [cr, cg, cb, ca] = this.color
    const src = this.snapshot.data
    const dst = this.target.data
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const p = y * w + x
        const m = this.mask[p]
        if (m <= 0) continue
        const i = p * 4
        dst[i] = src[i]
        dst[i + 1] = src[i + 1]
        dst[i + 2] = src[i + 2]
        dst[i + 3] = src[i + 3]
        const a = m * this.opacity
        if (this.mode === 'erase') dst[i + 3] = src[i + 3] * (1 - a)
        else over(dst, i, cr, cg, cb, a * (ca / 255))
      }
  }
}

/** Fill a rect on an image with a colour at the given opacity (source-over). */
export function fillRect(img: Img, r: Rect, color: RGBA, opacity: number, erase = false) {
  const a = opacity * (color[3] / 255)
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * img.w + x) * 4
      if (erase) img.data[i + 3] *= 1 - opacity
      else over(img.data, i, color[0], color[1], color[2], a)
    }
}

export interface CompositeLayer {
  img: Img
  visible: boolean
  opacity: number
}

/** Composite layers (bottom first) into `out` within rect. */
export function composite(layers: CompositeLayer[], out: Img, r: Rect = { x: 0, y: 0, w: out.w, h: out.h }) {
  const d = out.data
  for (let y = r.y; y < r.y + r.h; y++) {
    const row = y * out.w
    d.fill(0, (row + r.x) * 4, (row + r.x + r.w) * 4)
  }
  for (const l of layers) {
    if (!l.visible || l.opacity <= 0) continue
    const s = l.img.data
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * out.w + x) * 4
        const a = (s[i + 3] / 255) * l.opacity
        if (a > 0) over(d, i, s[i], s[i + 1], s[i + 2], a)
      }
  }
}

export function getPixel(img: Img, x: number, y: number): RGBA {
  const i = (y * img.w + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
}

/** Nearest-neighbour upscale or box-filter downscale to a new square size. */
export function resample(img: Img, size: number): Img {
  const out = createImg(size, size)
  if (size >= img.w) {
    const k = img.w / size
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const s = (Math.floor(y * k) * img.w + Math.floor(x * k)) * 4
        out.data.set(img.data.subarray(s, s + 4), (y * size + x) * 4)
      }
    return out
  }
  const k = img.w / size
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < k; sy++)
        for (let sx = 0; sx < k; sx++) {
          const i = ((y * k + sy) * img.w + x * k + sx) * 4
          const pa = img.data[i + 3]
          r += img.data[i] * pa
          g += img.data[i + 1] * pa
          b += img.data[i + 2] * pa
          a += pa
        }
      const o = (y * size + x) * 4
      if (a > 0) {
        out.data[o] = r / a
        out.data[o + 1] = g / a
        out.data[o + 2] = b / a
      }
      out.data[o + 3] = a / (k * k)
    }
  return out
}

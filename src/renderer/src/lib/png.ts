import type { Img } from '../skin/pixels'

export function imgToCanvas(img: Img): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.w
  c.height = img.h
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0)
  return c
}

export const imgToDataUrl = (img: Img) => imgToCanvas(img).toDataURL('image/png')

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Cannot decode image'))
    el.src = src
  })
}

export async function dataUrlToImg(src: string): Promise<Img> {
  const el = await loadImage(src)
  const c = document.createElement('canvas')
  c.width = el.naturalWidth
  c.height = el.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(el, 0, 0)
  const d = ctx.getImageData(0, 0, c.width, c.height)
  return { w: c.width, h: c.height, data: d.data }
}

import { createImg, writeRect, type Img } from '../skin/pixels'

export interface AtlasSlot {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Appends extra images below the skin texture (shelf packing, same width as the skin), so the
 * whole avatar uses a single texture. Returns the combined image and each image's slot.
 */
export function buildAtlas(skin: Img, extras: Record<string, Img>): { img: Img; slots: Record<string, AtlasSlot> } {
  const W = skin.w
  const slots: Record<string, AtlasSlot> = {}
  let x = 0
  let y = skin.h
  let rowH = 0
  // tallest first packs tighter
  const keys = Object.keys(extras).sort((a, b) => extras[b].h - extras[a].h || extras[b].w - extras[a].w)
  for (const k of keys) {
    const e = extras[k]
    if (e.w > W) throw new Error(`atlas item ${k} wider than the skin`)
    if (x + e.w > W) {
      x = 0
      y += rowH
      rowH = 0
    }
    slots[k] = { x, y, w: e.w, h: e.h }
    x += e.w
    rowH = Math.max(rowH, e.h)
  }
  const out = createImg(W, Math.max(1, y + rowH))
  out.data.set(skin.data)
  for (const k of keys) writeRect(out, { x: slots[k].x, y: slots[k].y, w: extras[k].w, h: extras[k].h }, extras[k].data)
  return { img: out, slots }
}

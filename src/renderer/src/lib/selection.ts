import type { SkinDoc } from '../skin/doc'
import type { Rect } from '../skin/layout'
import { clipRect, cloneImg, createImg, fillRect, over, readRect, unionRect, writeRect, type Img, type RGBA } from '../skin/pixels'
import { useEditor } from '../store/editor'

/*
 * Rectangular selection on what is being edited (the active skin layer, the selected hair
 * plane, or the selected face frame): painting stays inside it, and the selected pixels of the
 * active layer can be copied, cut, deleted, or lifted into a floating piece that is dragged
 * somewhere else and then placed (Enter / click outside) or cancelled (Esc).
 * While floating, the layer shows the piece live (base + piece), so the 3D view follows.
 */

interface Floating {
  target: Img // the image the piece floats over
  snap: Img // the layer before lifting / pasting (for undo and cancel)
  base: Img // the layer without the floating piece
  img: Img
  x: number
  y: number
  area: Rect // everything touched so far (for the undo entry)
}

let float: Floating | null = null
let clip: Img | null = null
/** What Ctrl+V should paste: the last pixel copy, or (when a layer was copied last) the layer. */
let lastCopy: 'pixels' | 'layer' | null = null

const store = () => useEditor.getState()

/** The image the selection works on: selected hair plane, selected face frame, or the active layer. */
export function editTarget(doc: SkinDoc): Img | null {
  const h = doc.hairPlane(doc.hairId)
  if (h) return h.img
  const f = doc.faceFrame ? doc.faces[doc.faceFrame] : undefined
  if (f) return f
  const l = doc.active
  return l && !l.locked && l.visible ? l.img : null
}

export const hasFloating = () => float !== null
export const pixelsCopiedLast = () => lastCopy === 'pixels' && clip !== null
export const noteLayerCopy = () => (lastCopy = 'layer')

/** Two rects' overlap (null when they don't touch). */
export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h)
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null
}

export function select(r: Rect | null) {
  store().set({ selection: r })
}

export function selectAll(doc: SkinDoc) {
  commitFloating(doc)
  const img = editTarget(doc)
  select(img ? { x: 0, y: 0, w: img.w, h: img.h } : null)
}

function render(doc: SkinDoc, f: Floating) {
  const l = { img: f.target }
  const before: Rect = f.area
  l.img.data.set(f.base.data)
  const r = { x: f.x, y: f.y, w: f.img.w, h: f.img.h }
  for (let y = 0; y < f.img.h; y++)
    for (let x = 0; x < f.img.w; x++) {
      const tx = f.x + x, ty = f.y + y
      if (tx < 0 || ty < 0 || tx >= l.img.w || ty >= l.img.h) continue
      const s = (y * f.img.w + x) * 4
      const a = f.img.data[s + 3] / 255
      if (a > 0) over(l.img.data, (ty * l.img.w + tx) * 4, f.img.data[s], f.img.data[s + 1], f.img.data[s + 2], a)
    }
  const vis = clipRect(r, l.img.w, l.img.h)
  f.area = unionRect(before, vis) ?? before
  doc.touched(l.img, f.area)
  store().set({ selection: vis, floatingOn: true })
}

/** Cut the selected pixels of the active layer into a floating piece (to move them). */
export function liftSelection(doc: SkinDoc): boolean {
  const sel = store().selection
  const img0 = editTarget(doc)
  const l = img0 && { img: img0 }
  if (!sel || !l || float) return false
  const r = clipRect(sel, l.img.w, l.img.h)
  if (!r) return false
  const img = createImg(r.w, r.h)
  img.data.set(readRect(l.img, r))
  const base = cloneImg(l.img)
  writeRect(base, r, new Uint8ClampedArray(r.w * r.h * 4))
  float = { target: l.img, snap: cloneImg(l.img), base, img, x: r.x, y: r.y, area: r }
  render(doc, float)
  return true
}

/** Paste the copied pixels as a floating piece (at the selection, or where they were copied). */
export function pasteFloating(doc: SkinDoc): boolean {
  const img0 = editTarget(doc)
  const l = img0 && { img: img0 }
  if (!clip || !l) return false
  commitFloating(doc)
  const at = store().selection ?? { x: 0, y: 0 }
  float = { target: l.img, snap: cloneImg(l.img), base: cloneImg(l.img), img: cloneImg(clip), x: at.x, y: at.y, area: { x: at.x, y: at.y, w: 1, h: 1 } }
  render(doc, float)
  return true
}

export function moveFloatingTo(doc: SkinDoc, x: number, y: number) {
  if (!float) return
  float.x = x
  float.y = y
  render(doc, float)
}

export const floatingPos = () => (float ? { x: float.x, y: float.y, w: float.img.w, h: float.img.h } : null)

/** Place the floating piece for good (one undo step). */
export function commitFloating(doc: SkinDoc) {
  const f = float
  if (!f) return
  float = null
  const r = clipRect(f.area, f.target.w, f.target.h)
  if (r) doc.commitEdit(f.target, f.snap, r)
  store().set({ floatingOn: false })
}

/** Put everything back as it was before lifting / pasting. */
export function cancelFloating(doc: SkinDoc) {
  const f = float
  if (!f) return
  float = null
  f.target.data.set(f.snap.data)
  doc.touched(f.target, f.area)
  store().set({ floatingOn: false })
}

export function copySelection(doc: SkinDoc): boolean {
  const sel = store().selection
  const img0 = editTarget(doc)
  const l = img0 && { img: img0 }
  if (!sel || !l) return false
  if (float) {
    clip = cloneImg(float.img)
  } else {
    const r = clipRect(sel, l.img.w, l.img.h)
    if (!r) return false
    clip = createImg(r.w, r.h)
    clip.data.set(readRect(l.img, r))
  }
  lastCopy = 'pixels'
  return true
}

/** Clear the selected pixels of the active layer (one undo step). */
export function deleteSelection(doc: SkinDoc): boolean {
  if (float) {
    // deleting a floating piece = dropping it, leaving the hole it was lifted from
    float.img = createImg(float.img.w, float.img.h)
    render(doc, float)
    commitFloating(doc)
    return true
  }
  const sel = store().selection
  const img0 = editTarget(doc)
  const l = img0 && { img: img0 }
  if (!sel || !l) return false
  const r = clipRect(sel, l.img.w, l.img.h)
  if (!r) return false
  const snap = cloneImg(l.img)
  writeRect(l.img, r, new Uint8ClampedArray(r.w * r.h * 4))
  doc.touched(l.img, r)
  doc.commitEdit(l.img, snap, r)
  return true
}

/** Bucket inside a selection: fill the whole selected area of the active layer. */
export function fillSelection(doc: SkinDoc, color: RGBA, opacity: number): boolean {
  const sel = store().selection
  const img0 = editTarget(doc)
  const l = img0 && { img: img0 }
  if (!sel || !l) return false
  const r = clipRect(sel, l.img.w, l.img.h)
  if (!r) return false
  const snap = cloneImg(l.img)
  fillRect(l.img, r, color, opacity)
  doc.touched(l.img, r)
  doc.commitEdit(l.img, snap, r)
  return true
}

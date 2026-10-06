import i18n from '../i18n'
import { isNoModify, type SkinDoc } from '../skin/doc'
import type { Rect } from '../skin/layout'
import { cloneImg, drawGradient, getPixel, readRect, writeRect, type Img, type Stroke } from '../skin/pixels'
import { faceAt, faceRect } from '../skin/layout'
import type { FaceFrame } from '../skin/figura'
import { useEditor } from '../store/editor'
import { confirmBox, toast } from '../ui/common/dialogs'

/**
 * Shared pointer-to-pixels logic for the 3D viewport and the 2D UV panel.
 * Coordinates are texels; `clip` (3D only) keeps a stroke inside the face it started on.
 */
export class PaintSession {
  private stroke: Stroke | null = null
  private last: [number, number] | null = null
  private lastClip: Rect | null = null
  private hairId: string | null = null
  /** Smoothed brush position (texels) for the rope stabilizer. */
  private rope: [number, number] | null = null
  /** Gradient drag in progress: the image, its pixels before the drag, the area and start point. */
  private grad: { img: Img; snap: Img; rect: Rect; p0: [number, number]; moved: boolean } | null = null

  constructor(private doc: SkinDoc) {}

  get active() {
    return this.stroke !== null || this.grad !== null
  }

  /** Start a gradient on an image (the face / area under the pointer for skin layers). */
  private downGradient(img: Img, rect: Rect, x: number, y: number): boolean {
    this.grad = { img, snap: cloneImg(img), rect, p0: [x + 0.5, y + 0.5], moved: false }
    return true
  }

  private moveGradient(x: number, y: number) {
    const g = this.grad!
    const ed = useEditor.getState()
    writeRect(g.img, g.rect, readRect(g.snap, g.rect))
    drawGradient(g.img, g.rect, g.p0, [x + 0.5, y + 0.5], ed.color, ed.color2, ed.brush.opacity, ed.gradientSteps)
    g.moved = true
    this.doc.touched(g.img, g.rect)
  }

  /** Returns true if the pointer should be captured for a drag stroke. */
  down(x: number, y: number, clip: Rect | null, hairId: string | null = null, face = false): boolean {
    const ed = useEditor.getState()
    const { doc } = this
    this.hairId = hairId
    // painting stops the test motion so the model holds still while you draw
    if (ed.motion !== 'off' && ed.tool !== 'orbit') ed.set({ motion: 'off' })
    if (hairId) return this.downHair(hairId, x, y, clip)
    if (doc.faceFrame && face) return this.downFace(doc.faceFrame, x, y)
    if (ed.tool === 'picker') {
      const c = doc.pick(x, y)
      if (c[3] > 0) ed.set({ color: [c[0], c[1], c[2], 255] })
      return false
    }
    if (!this.allowed()) return false
    if (ed.tool === 'gradient') {
      const l = doc.active
      if (!l || l.locked || !l.visible) {
        toast(i18n.t('layers.blocked'))
        return false
      }
      // 3D strokes stay on the face they started on; in the UV panel use the face under the pointer
      const ref = clip ? null : faceAt(doc.variant, doc.res, x, y)
      const rect = clip ?? (ref ? faceRect(doc.variant, doc.res, ref) : null)
      return rect ? this.downGradient(l.img, rect, x, y) : false
    }
    if (ed.tool === 'bucket') {
      if (doc.fill(x, y, ed.fillMode, ed.color, ed.brush.opacity, false, ed.mirror)) ed.pushRecent(ed.color)
      return false
    }
    if (ed.tool !== 'brush' && ed.tool !== 'eraser') return false
    const b = ed.tool === 'eraser' ? ed.eraser : ed.brush
    this.stroke = doc.beginStroke(ed.color, b.opacity, ed.tool === 'eraser' ? 'erase' : 'paint')
    if (!this.stroke) {
      toast(i18n.t('layers.blocked'))
      return false
    }
    doc.stamp(this.stroke, x, y, b, clip, ed.mirror)
    this.last = [x, y]
    this.lastClip = clip
    return true
  }

  /** Hair planes have their own textures: no mirror, no license check, select on click. */
  private downHair(id: string, x: number, y: number, clip: Rect | null): boolean {
    const ed = useEditor.getState()
    const { doc } = this
    const h = doc.hairPlane(id)
    if (!h) return false
    if (doc.hairId !== id) doc.selectHair(id)
    if (ed.tool === 'picker') {
      const c = getPixel(h.img, x, y)
      if (c[3] > 0) ed.set({ color: [c[0], c[1], c[2], 255] })
      return false
    }
    if (ed.tool === 'bucket') {
      if (doc.fillHair(id, ed.color, ed.brush.opacity)) ed.pushRecent(ed.color)
      return false
    }
    if (ed.tool === 'gradient') return this.downGradient(h.img, { x: 0, y: 0, w: h.img.w, h: h.img.h }, x, y)
    if (ed.tool !== 'brush' && ed.tool !== 'eraser') return false
    const b = ed.tool === 'eraser' ? ed.eraser : ed.brush
    this.stroke = doc.beginHairStroke(id, ed.color, b.opacity, ed.tool === 'eraser' ? 'erase' : 'paint')
    if (!this.stroke) return false
    doc.stamp(this.stroke, x, y, b, clip, false)
    this.last = [x, y]
    this.lastClip = clip
    return true
  }

  /** Face frames (expressions etc.) mirror across the face centre when Mirror is on. */
  private downFace(f: FaceFrame, x: number, y: number): boolean {
    const ed = useEditor.getState()
    const img = this.doc.faces[f]
    if (!img) return false
    if (ed.tool === 'picker') {
      // a see-through pixel of the frame picks what shows there: the base face, then the skin
      const base = this.doc.faces.base
      const under = [img, f !== 'base' && base?.w === img.w ? base : null, this.doc.faceImage()]
      const c = under.map((i) => (i ? getPixel(i, x, y) : null)).find((p) => p && p[3] > 0)
      if (c) ed.set({ color: [c[0], c[1], c[2], 255] })
      return false
    }
    if (ed.tool === 'gradient') return this.downGradient(img, { x: 0, y: 0, w: img.w, h: img.h }, x, y)
    if (ed.tool !== 'brush' && ed.tool !== 'eraser') return false
    const b = ed.tool === 'eraser' ? ed.eraser : ed.brush
    this.stroke = this.doc.beginFaceStroke(f, ed.color, b.opacity, ed.tool === 'eraser' ? 'erase' : 'paint')
    if (!this.stroke) return false
    this.doc.stamp(this.stroke, x, y, b, null, ed.mirror)
    this.last = [x, y]
    this.lastClip = null
    return true
  }

  /** The hair plane the current stroke paints on (strokes never jump between targets). */
  get strokeHair() {
    return this.hairId
  }

  move(x: number, y: number, clip: Rect | null) {
    if (this.grad) return this.moveGradient(x, y)
    if (!this.stroke || !this.last) return
    const ed = useEditor.getState()
    const b = ed.tool === 'eraser' ? ed.eraser : ed.brush
    const sameFace = clip === this.lastClip || (clip && this.lastClip && clip.x === this.lastClip.x && clip.y === this.lastClip.y)
    // rope stabilizer: the brush only follows once the pointer is more than R texels away
    if (b.smooth > 0 && sameFace) {
      const R = b.smooth * Math.max(3, this.doc.res / 12)
      const r = (this.rope ??= [this.last[0], this.last[1]])
      const d = Math.hypot(x - r[0], y - r[1])
      if (d <= R) return
      r[0] += ((x - r[0]) * (d - R)) / d
      r[1] += ((y - r[1]) * (d - R)) / d
      x = Math.round(r[0])
      y = Math.round(r[1])
    } else this.rope = null
    if (this.last[0] === x && this.last[1] === y) return
    const mirror = ed.mirror && !this.hairId // face frames mirror inside doc.stamp
    if (sameFace) this.doc.strokeLine(this.stroke, this.last, [x, y], b, clip, mirror)
    else this.doc.stamp(this.stroke, x, y, b, clip, mirror)
    this.last = [x, y]
    this.lastClip = clip
  }

  up() {
    const ed = useEditor.getState()
    const g = this.grad
    if (g) {
      this.grad = null
      if (g.moved) {
        this.doc.commitEdit(g.img, g.snap, g.rect)
        ed.pushRecent(ed.color)
      }
      return
    }
    this.rope = null
    if (!this.stroke) return
    this.doc.endStroke(this.stroke)
    if (ed.tool === 'brush') ed.pushRecent(ed.color)
    this.stroke = null
    this.last = null
  }

  /** Warn once per session before editing a layer whose license forbids modification. */
  private allowed(): boolean {
    const ed = useEditor.getState()
    const l = this.doc.active
    if (!l || !isNoModify(l.meta) || ed.approvedNoMod.has(l.id)) return true
    confirmBox(i18n.t('layers.noModWarn', { name: l.name }), i18n.t('common.ok'), i18n.t('common.cancel'), true).then((ok) => {
      if (ok) ed.set({ approvedNoMod: new Set([...useEditor.getState().approvedNoMod, l.id]) })
    })
    return false
  }
}

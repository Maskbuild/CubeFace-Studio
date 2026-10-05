import i18n from '../i18n'
import { isNoModify, type SkinDoc } from '../skin/doc'
import type { Rect } from '../skin/layout'
import { getPixel, type Stroke } from '../skin/pixels'
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

  constructor(private doc: SkinDoc) {}

  get active() {
    return this.stroke !== null
  }

  /** Returns true if the pointer should be captured for a drag stroke. */
  down(x: number, y: number, clip: Rect | null, hairId: string | null = null): boolean {
    const ed = useEditor.getState()
    const { doc } = this
    this.hairId = hairId
    // painting stops the test motion so the model holds still while you draw
    if (ed.motion !== 'off' && ed.tool !== 'orbit') ed.set({ motion: 'off' })
    if (hairId) return this.downHair(hairId, x, y, clip)
    if (ed.tool === 'picker') {
      const c = doc.pick(x, y)
      if (c[3] > 0) ed.set({ color: [c[0], c[1], c[2], 255] })
      return false
    }
    if (!this.allowed()) return false
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
    if (ed.tool !== 'brush' && ed.tool !== 'eraser') return false
    const b = ed.tool === 'eraser' ? ed.eraser : ed.brush
    this.stroke = doc.beginHairStroke(id, ed.color, b.opacity, ed.tool === 'eraser' ? 'erase' : 'paint')
    if (!this.stroke) return false
    doc.stamp(this.stroke, x, y, b, clip, false)
    this.last = [x, y]
    this.lastClip = clip
    return true
  }

  /** The hair plane the current stroke paints on (strokes never jump between targets). */
  get strokeHair() {
    return this.hairId
  }

  move(x: number, y: number, clip: Rect | null) {
    if (!this.stroke || !this.last) return
    if (this.last[0] === x && this.last[1] === y) return
    const ed = useEditor.getState()
    const b = ed.tool === 'eraser' ? ed.eraser : ed.brush
    const sameFace = clip === this.lastClip || (clip && this.lastClip && clip.x === this.lastClip.x && clip.y === this.lastClip.y)
    const mirror = ed.mirror && !this.hairId
    if (sameFace) this.doc.strokeLine(this.stroke, this.last, [x, y], b, clip, mirror)
    else this.doc.stamp(this.stroke, x, y, b, clip, mirror)
    this.last = [x, y]
    this.lastClip = clip
  }

  up() {
    if (!this.stroke) return
    const ed = useEditor.getState()
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

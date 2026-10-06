import * as THREE from 'three'
import type { SkinDoc } from '../skin/doc'
import { allFrames, coversEyes, type ExprKey, type FaceFrame } from '../skin/figura'
import { createImg, type Img } from '../skin/pixels'
import { faceWithFrame } from '../figura/avatar'

function tex(img: Img) {
  const t = new THREE.DataTexture(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.length), img.w, img.h, THREE.RGBAFormat)
  t.magFilter = t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.flipY = false
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

/** Plane on the head front (head space): x -4..4, y 0..8; texture u=0 on the player's right (-X). */
function facePlane(z: number) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([-4, 8, z, 4, 8, z, -4, 0, z, 4, 0, z], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2))
  g.setIndex([0, 2, 1, 1, 2, 3])
  return g
}

/** In-app preview of the generated face frames (mirrors what script.lua does in game). */
export class FiguraRig {
  private root = new THREE.Group()
  private frames = new Map<FaceFrame, THREE.Mesh>()
  private eyes: { mesh: THREE.Mesh; tex: THREE.DataTexture; w: number; h: number }[] = []
  private eyeShift = [0, 0]
  private disposables: { dispose(): void }[] = []
  private key = ''
  enabled = false
  expr: ExprKey | null = null
  /** Frame selected for painting: always shown (alone) so you can see what you draw. */
  editFrame: FaceFrame | null = null
  talk = false
  blink = false
  private blinkIn = 60
  private blinkLeft = 0
  private flap = 0

  constructor(head: THREE.Group) {
    head.add(this.root)
  }

  /** Rebuild when the set of frames changes; otherwise only update visibility. */
  sync(doc: SkinDoc) {
    const key = allFrames(doc.figura).map((f) => f + (doc.faces[f]?.w ?? 0)).join()
    if (key !== this.key) {
      this.key = key
      this.clear()
      // slightly in front of the face, behind the hat layer
      let z = 4.02
      for (const f of allFrames(doc.figura).filter((x) => doc.faces[x])) {
        const img = doc.faces[f] as Img
        const t = tex(img)
        const m = new THREE.Mesh(facePlane((z += 0.002)), new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.02, depthWrite: false }))
        m.renderOrder = 2
        this.disposables.push(t, m.geometry, m.material as THREE.Material)
        this.frames.set(f, m)
        this.root.add(m)
      }
    }
    this.buildEyes(doc)
    this.applyVisibility(doc)
  }

  /** Eye boxes cut from the face, drawn just in front of the base face (rebuilt on every sync). */
  private buildEyes(doc: SkinDoc) {
    for (const e of this.eyes) {
      e.mesh.removeFromParent()
      e.mesh.geometry.dispose()
      ;(e.mesh.material as THREE.Material).dispose()
      e.tex.dispose()
    }
    this.eyes = []
    const cfg = doc.figura
    if (!cfg.eyeFollow) return
    const face = faceWithFrame(doc, 'base')
    const k = doc.res / 64
    for (const r of [cfg.eyeR, cfg.eyeL]) {
      if (r.w < 1 || r.h < 1) continue
      const img = createImg(r.w, r.h)
      for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++) {
          const sx = Math.min(face.w - 1, r.x + x), sy = Math.min(face.h - 1, r.y + y)
          img.data.set(face.data.subarray((sy * face.w + sx) * 4, (sy * face.w + sx) * 4 + 4), (y * r.w + x) * 4)
        }
      const t = tex(img)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      const x0 = -4 + r.x / k, x1 = -4 + (r.x + r.w) / k
      const y1 = 8 - r.y / k, y0 = 8 - (r.y + r.h) / k
      const g = new THREE.BufferGeometry()
      const z = 4.023 // between the base face (4.022) and the next frame (4.024)
      g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y1, z, x1, y1, z, x0, y0, z, x1, y0, z], 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2))
      g.setIndex([0, 2, 1, 1, 2, 3])
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.02, depthWrite: false }))
      m.renderOrder = 2
      this.root.add(m)
      this.eyes.push({ mesh: m, tex: t, w: r.w, h: r.h })
    }
  }

  /**
   * Slide the eyes towards where the head turns (app space: + yaw = towards the player's left,
   * + pitch = looking down). Whole texels, eased like the exported script.
   */
  updateEyes(doc: SkinDoc, head: THREE.Object3D) {
    if (!this.eyes.length) return
    const e = new THREE.Euler().setFromQuaternion(head.quaternion, 'YXZ')
    const range = doc.figura.eyeRange
    const c = (v: number) => Math.max(-1, Math.min(1, v))
    this.eyeShift[0] += (c(e.y / 0.785) * range - this.eyeShift[0]) * 0.3
    this.eyeShift[1] += (c(e.x / 0.785) * range - this.eyeShift[1]) * 0.3
    const du = Math.round(this.eyeShift[0]), dv = Math.round(this.eyeShift[1])
    // looking to the player's left shows the iris further along +u (towards the left side of the face)
    for (const eye of this.eyes) eye.tex.offset.set(-du / eye.w, -dv / eye.h)
  }

  private clear() {
    this.root.clear()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    this.frames.clear()
  }

  applyVisibility(doc: SkinDoc) {
    const cfg = doc.figura
    this.root.visible = this.enabled || !!this.editFrame
    for (const [f, m] of this.frames) {
      if (this.editFrame) m.visible = f === this.editFrame || (f === 'base' && this.editFrame !== 'base')
      else if (f === 'base') m.visible = true
      else if (f === 'blink') m.visible = cfg.blink && this.blink && !(this.expr && coversEyes(this.expr, cfg))
      else if (f === 'talk') m.visible = cfg.talk && this.talk && this.flap < 2
      else m.visible = cfg.expressions && this.expr === f
    }
    const closed = (cfg.blink && this.blink) || (!!this.expr && coversEyes(this.expr, cfg))
    for (const e of this.eyes) e.mesh.visible = !this.editFrame && !closed
  }

  /** Game tick: blink timer and talking flap. */
  tick(doc: SkinDoc) {
    const cfg = doc.figura
    if (this.blinkLeft > 0) {
      if (--this.blinkLeft === 0) this.blink = false
    } else if (--this.blinkIn <= 0) {
      this.blink = true
      this.blinkLeft = 3
      this.blinkIn = Math.round((cfg.blinkMin + Math.random() * (cfg.blinkMax - cfg.blinkMin)) * 20)
    }
    this.flap = this.talk ? (this.flap + 1) % 4 : 0
    this.applyVisibility(doc)
  }

  textureChanged(f: FaceFrame) {
    const m = this.frames.get(f)
    const map = m && (m.material as THREE.MeshBasicMaterial).map
    if (map) map.needsUpdate = true
  }

  dispose() {
    this.clear()
    this.root.removeFromParent()
  }
}

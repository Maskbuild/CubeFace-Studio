import * as THREE from 'three'
import type { SkinDoc } from '../skin/doc'
import { coversEyes, type ExprKey, type FaceFrame } from '../skin/figura'
import type { Img } from '../skin/pixels'

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
    const key = Object.entries(doc.faces).map(([f, i]) => f + (i?.w ?? 0)).join()
    if (key !== this.key) {
      this.key = key
      this.clear()
      // slightly in front of the face, behind the hat layer
      let z = 4.02
      for (const [f, img] of Object.entries(doc.faces) as [FaceFrame, Img][]) {
        const t = tex(img)
        const m = new THREE.Mesh(facePlane((z += 0.002)), new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.02, depthWrite: false }))
        m.renderOrder = 2
        this.disposables.push(t, m.geometry, m.material as THREE.Material)
        this.frames.set(f, m)
        this.root.add(m)
      }
    }
    this.applyVisibility(doc)
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
      if (this.editFrame) m.visible = f === this.editFrame
      else if (f === 'blink') m.visible = cfg.blink && this.blink && !(this.expr && coversEyes(this.expr, cfg))
      else if (f === 'talk') m.visible = cfg.talk && this.talk && this.flap < 2
      else m.visible = cfg.expressions && this.expr === f
    }
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

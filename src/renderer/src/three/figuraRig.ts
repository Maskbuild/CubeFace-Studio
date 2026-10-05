import * as THREE from 'three'
import type { SkinDoc } from '../skin/doc'
import { coversEyes, eyeParts, sampleFace, type ExprKey, type FaceFrame } from '../skin/figura'
import { extraParts, type ExtraPart } from '../skin/extras'
import { HairSim, type Motion } from '../skin/hair'
import type { Img, RGBA } from '../skin/pixels'

const D2R = Math.PI / 180

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
function facePlane(x0: number, x1: number, y0: number, y1: number, z: number, uv: [number, number, number, number] = [0, 0, 1, 1]) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y1, z, x1, y1, z, x0, y0, z, x1, y0, z], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([uv[0], uv[1], uv[2], uv[1], uv[0], uv[3], uv[2], uv[3]], 2))
  g.setIndex([0, 2, 1, 1, 2, 3])
  return g
}

const SHADE = [0.8, 0.8, 1, 0.66, 1, 0.86] // +x -x +y -y +z -z

function shadedBox(size: THREE.Vector3Tuple, min: THREE.Vector3Tuple, color: string) {
  const g = new THREE.BoxGeometry(...size)
  g.translate(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2)
  const c = new THREE.Color(color)
  const cols: number[] = []
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) cols.push(c.r * SHADE[f], c.g * SHADE[f], c.b * SHADE[f])
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  return g
}

interface Iris {
  mesh: THREE.Mesh
  w: number
  h: number
  pad: number
  img: Img
}

/** In-app preview of the generated Figura features (mirrors what script.lua does in game). */
export class FiguraRig {
  private root = new THREE.Group()
  private bodyRoot = new THREE.Group()
  private frames = new Map<FaceFrame, THREE.Mesh>()
  private iris: Iris[] = []
  private sclera: THREE.Mesh[] = []
  private extras: { part: ExtraPart; segs: THREE.Group[]; sim: HairSim | null }[] = []
  private disposables: { dispose(): void }[] = []
  private key = ''
  enabled = false
  expr: ExprKey | null = null
  /** Frame selected for painting: always shown (alone) so you can see what you draw. */
  editFrame: FaceFrame | null = null
  talk = false
  blink = false
  private eye = new THREE.Vector2()
  private blinkIn = 60
  private blinkLeft = 0
  private flap = 0

  constructor(head: THREE.Group, body: THREE.Group) {
    head.add(this.root)
    body.add(this.bodyRoot)
  }

  /** Rebuild from the document when the Figura config or frames changed. */
  sync(doc: SkinDoc, force = false) {
    const cfg = doc.figura
    const key = JSON.stringify(cfg) + Object.keys(doc.faces).join() + doc.res + Object.values(doc.masks).map((m) => m && m.data.reduce((a, v, i) => (i % 4 === 3 && v ? a + i : a), 0)).join()
    if (!force && key === this.key) return this.applyVisibility(doc)
    this.key = key
    this.clear()
    // face frames, slightly in front of the face but behind the hat layer
    let z = 4.02
    for (const [f, img] of Object.entries(doc.faces) as [FaceFrame, Img][]) {
      const t = tex(img)
      const m = new THREE.Mesh(facePlane(-4, 4, 0, 8, (z += 0.002)), new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.02, depthWrite: false }))
      m.renderOrder = 2
      this.disposables.push(t, m.geometry, m.material as THREE.Material)
      this.frames.set(f, m)
      this.root.add(m)
    }
    // smooth eyes: eye whites over the painted eyes, irises on top that can shift
    if (cfg.smoothEyes) {
      const face = doc.faceImage()
      const { light } = sampleFace(face, cfg, doc.masks)
      const px = 8 / face.w
      for (const [r, mask] of [[cfg.eyeR, doc.masks.eyeR], [cfg.eyeL, doc.masks.eyeL]] as const) {
        const x0 = -4 + r.x * px, x1 = -4 + (r.x + r.w) * px, y1 = 8 - r.y * px, y0 = 8 - (r.y + r.h) * px
        // the eye as painted, minus the iris (replaced by sclera), then the moving iris on top
        const parts = eyeParts(face, r, mask, light as RGBA, cfg.eyeShift)
        const baseTex = tex(parts.base)
        const white = new THREE.Mesh(facePlane(x0, x1, y0, y1, 4.012), new THREE.MeshBasicMaterial({ map: baseTex, transparent: true, alphaTest: 0.02 }))
        this.disposables.push(baseTex)
        const img = parts.iris
        const t = tex(img)
        const iris = new THREE.Mesh(facePlane(x0, x1, y0, y1, 4.016), new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.02 }))
        this.disposables.push(t, white.geometry, white.material as THREE.Material, iris.geometry, iris.material as THREE.Material)
        this.sclera.push(white)
        this.iris.push({ mesh: iris, w: r.w, h: r.h, pad: cfg.eyeShift, img })
        this.root.add(white, iris)
      }
    }
    // ears and tail
    for (const part of extraParts(cfg.ears, cfg.tail)) {
      const parent = part.attach === 'head' ? this.root : this.bodyRoot
      let p: THREE.Object3D = parent
      const segs: THREE.Group[] = []
      part.segments.forEach((sg, i) => {
        const g = new THREE.Group()
        if (i === 0) {
          g.position.set(...part.pivot)
          g.rotation.set(part.rest[0] * D2R, part.rest[1] * D2R, part.rest[2] * D2R, 'YXZ')
        } else g.position.set(...part.segments[i - 1].next)
        for (const b of sg.boxes) {
          const geo = shadedBox(b.size, b.min, b.color === 'fur' ? cfg.furColor : cfg.furInner)
          const mat = new THREE.MeshBasicMaterial({ vertexColors: true })
          this.disposables.push(geo, mat)
          g.add(new THREE.Mesh(geo, mat))
        }
        p.add(g)
        p = g
        segs.push(g)
      })
      const sim = part.physics && cfg.extrasPhysics ? new HairSim(segs.length, 'back', { stiffness: 0.18, damping: 0.22, gravity: 0.5, drag: 2.5, sway: 1, limitIn: 30, limitOut: 70 }) : null
      this.extras.push({ part, segs, sim })
    }
    this.applyVisibility(doc)
  }

  private clear() {
    this.root.clear()
    this.bodyRoot.clear()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    this.frames.clear()
    this.iris = []
    this.sclera = []
    this.extras = []
  }

  applyVisibility(doc: SkinDoc) {
    const cfg = doc.figura
    this.root.visible = this.bodyRoot.visible = this.enabled || !!this.editFrame
    for (const [f, m] of this.frames) {
      if (this.editFrame) m.visible = f === this.editFrame
      else if (f === 'blink') m.visible = cfg.blink && this.blink
      else if (f === 'talk') m.visible = cfg.talk && this.talk && this.flap < 2
      else m.visible = cfg.expressions && this.expr === f
    }
    const shown = this.editFrame ?? this.expr
    const hide = this.editFrame ? coversEyes(this.editFrame, cfg) : (cfg.blink && this.blink) || (shown !== null && coversEyes(shown, cfg))
    for (const i of this.iris) i.mesh.visible = !hide
  }

  /** Game tick: blink timer, talking flap and tail physics. */
  tick(doc: SkinDoc, m: Motion | null, blinkMin: number, blinkMax: number) {
    if (this.blinkLeft > 0) {
      if (--this.blinkLeft === 0) this.blink = false
    } else if (--this.blinkIn <= 0) {
      this.blink = true
      this.blinkLeft = 3
      this.blinkIn = Math.round((blinkMin + Math.random() * (blinkMax - blinkMin)) * 20)
    }
    this.flap = this.talk ? (this.flap + 1) % 4 : 0
    for (const e of this.extras) e.sim?.step(m ?? { vx: 0, vy: 0, vz: 0, pitch: 0, yawRate: 0 })
    this.applyVisibility(doc)
  }

  /** Per frame: tail angles and iris gaze (look = head yaw/pitch relative to the body, radians). */
  frame(alpha: number, look: [number, number], shift: number, dt: number) {
    for (const e of this.extras) {
      if (!e.sim) continue
      e.segs.forEach((g, i) => {
        const [out, roll] = e.sim!.sample(i, alpha)
        g.rotation.x = (i === 0 ? e.part.rest[0] * D2R : 0) + out
        g.rotation.z = (i === 0 ? e.part.rest[2] * D2R : 0) + roll
      })
    }
    const want = new THREE.Vector2(THREE.MathUtils.clamp(-look[0] / 0.87, -1, 1), THREE.MathUtils.clamp(look[1] / 0.78, -1, 1)).multiplyScalar(shift)
    this.eye.lerp(want, 1 - Math.pow(0.7, dt * 20))
    for (const i of this.iris) {
      const dx = Math.round(this.eye.x), dy = Math.round(this.eye.y)
      const u0 = (i.pad - dx) / i.img.w, v0 = (i.pad - dy) / i.img.h
      const uv = i.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute
      const u1 = u0 + i.w / i.img.w, v1 = v0 + i.h / i.img.h
      uv.set([u0, v0, u1, v0, u0, v1, u1, v1])
      uv.needsUpdate = true
    }
  }

  textureChanged(f: FaceFrame) {
    const m = this.frames.get(f)
    const map = m && (m.material as THREE.MeshBasicMaterial).map
    if (map) map.needsUpdate = true
  }

  dispose() {
    this.clear()
    this.root.removeFromParent()
    this.bodyRoot.removeFromParent()
  }
}

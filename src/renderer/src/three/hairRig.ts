import * as THREE from 'three'
import { HairSim, type HairPlane, type Motion } from '../skin/hair'
import type { Img } from '../skin/pixels'

export interface HairMeshInfo {
  hairId: string
  seg: number
}

interface Entry {
  plane: HairPlane
  root: THREE.Group
  segs: THREE.Group[]
  meshes: THREE.Mesh[]
  outline: THREE.LineSegments[]
  tex: THREE.DataTexture
  mat: THREE.MeshBasicMaterial
  sim: HairSim
}

const D2R = Math.PI / 180

function makeTexture(img: Img) {
  const t = new THREE.DataTexture(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.length), img.w, img.h, THREE.RGBAFormat)
  t.magFilter = t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.flipY = false
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

/** Plane for one segment: top edge at the group origin, texture rows [v0, v1] of the full image. */
function segGeometry(w: number, len: number, v0: number, v1: number) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, 0, 0, w / 2, 0, 0, -w / 2, -len, 0, w / 2, -len, 0], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, v0, 1, v0, 0, v1, 1, v1], 2))
  g.setIndex([0, 2, 1, 1, 2, 3])
  return g
}

function outlineGeometry(w: number, len: number) {
  const g = new THREE.BufferGeometry()
  const z = 0.01
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, 0, z, w / 2, 0, z, w / 2, 0, z, w / 2, -len, z, w / 2, -len, z, -w / 2, -len, z, -w / 2, -len, z, -w / 2, 0, z], 3))
  return g
}

/**
 * Hair planes attached to the head joint. Each plane is a chain of segments (one child group
 * per segment) so physics can bend it like the exported Figura model will.
 */
export class HairRig {
  private entries = new Map<string, Entry>()
  private outlineMat = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.6 })
  private selectedMat = new THREE.LineBasicMaterial({ color: 0x3fd6e3 })
  selectedId: string | null = null
  showOutlines = true

  constructor(private head: THREE.Group) {}

  get meshes(): THREE.Mesh[] {
    return [...this.entries.values()].flatMap((e) => (e.root.visible ? e.meshes : []))
  }

  root(id: string) {
    return this.entries.get(id)?.root
  }

  setAccent(color: string) {
    this.selectedMat.color.set(color)
  }

  /** Rebuild planes whose shape changed; keep textures/sim state for the rest. */
  sync(planes: HairPlane[]) {
    const seen = new Set<string>()
    for (const p of planes) {
      seen.add(p.id)
      const e = this.entries.get(p.id)
      const shapeSame = e && e.plane.w === p.w && e.plane.h === p.h && e.plane.segments === p.segments
      if (e && shapeSame) {
        if (e.plane.img !== p.img) {
          e.tex.dispose()
          e.tex = makeTexture(p.img)
          e.mat.map = e.tex
        }
        e.plane = p
        e.sim.side = p.side
        e.sim.phys = p.phys
        this.place(e)
        continue
      }
      if (e) this.dispose(e)
      this.entries.set(p.id, this.build(p))
    }
    for (const [id, e] of this.entries) if (!seen.has(id)) this.dispose(e), this.entries.delete(id)
    this.refreshOutlines()
  }

  private build(p: HairPlane): Entry {
    const tex = makeTexture(p.img)
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.02 })
    const root = new THREE.Group()
    const segs: THREE.Group[] = []
    const meshes: THREE.Mesh[] = []
    const outline: THREE.LineSegments[] = []
    const len = p.h / p.segments
    let parent: THREE.Object3D = root
    for (let i = 0; i < p.segments; i++) {
      const g = new THREE.Group()
      g.position.y = i === 0 ? 0 : -len
      const m = new THREE.Mesh(segGeometry(p.w, len, i / p.segments, (i + 1) / p.segments), mat)
      m.userData = { hairId: p.id, seg: i } satisfies HairMeshInfo
      m.renderOrder = 1
      const o = new THREE.LineSegments(outlineGeometry(p.w, len), this.outlineMat)
      g.add(m, o)
      parent.add(g)
      parent = g
      segs.push(g)
      meshes.push(m)
      outline.push(o)
    }
    this.head.add(root)
    const e: Entry = { plane: p, root, segs, meshes, outline, tex, mat, sim: new HairSim(p.segments, p.side, p.phys) }
    this.place(e)
    return e
  }

  private place(e: Entry) {
    const p = e.plane
    e.root.position.set(...p.pos)
    e.root.rotation.set(p.rot[0] * D2R, p.rot[1] * D2R, p.rot[2] * D2R, 'YXZ')
    e.root.visible = p.visible
  }

  private dispose(e: Entry) {
    e.root.removeFromParent()
    e.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
    e.mat.dispose()
    e.tex.dispose()
  }

  refreshOutlines() {
    for (const e of this.entries.values()) {
      const sel = e.plane.id === this.selectedId
      for (const o of e.outline) {
        o.material = sel ? this.selectedMat : this.outlineMat
        o.visible = sel || this.showOutlines
      }
    }
  }

  textureChanged(id: string) {
    const e = this.entries.get(id)
    if (e) e.tex.needsUpdate = true
  }

  tick(m: Motion) {
    for (const e of this.entries.values()) e.sim.step(m)
  }

  /** Apply interpolated physics angles; outward swing = rotate the lower edge towards local +Z. */
  applyPhysics(alpha: number, on: boolean) {
    for (const e of this.entries.values())
      e.segs.forEach((g, i) => {
        const [out, roll] = on ? e.sim.sample(i, alpha) : [0, 0]
        g.rotation.set(-out, 0, roll)
      })
  }

  disposeAll() {
    for (const e of this.entries.values()) this.dispose(e)
    this.entries.clear()
    this.outlineMat.dispose()
    this.selectedMat.dispose()
  }
}

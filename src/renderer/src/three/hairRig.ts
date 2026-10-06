import * as THREE from 'three'
import { hairOpts, HairSim, livePhys, strandVariation, type HairPlane, type Motion } from '../skin/hair'
import type { Img } from '../skin/pixels'

export interface HairMeshInfo {
  hairId: string
  seg: number
}

/** One strand: a chain of segment groups with its own physics. */
interface Strand {
  segs: THREE.Group[]
  meshes: THREE.Mesh[]
  outline: THREE.LineSegments[]
  grids: THREE.LineSegments[]
  sim: HairSim
}

interface Entry {
  plane: HairPlane
  root: THREE.Group
  strands: Strand[]
  tex: THREE.DataTexture
  mat: THREE.MeshBasicMaterial
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

/** Plane for one segment: top edge at the group origin, texture rows [v0, v1] and columns [u0, u1]. */
function segGeometry(w: number, len: number, v0: number, v1: number, u0 = 0, u1 = 1) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, 0, 0, w / 2, 0, 0, -w / 2, -len, 0, w / 2, -len, 0], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u0, v1, u1, v1], 2))
  g.setIndex([0, 2, 1, 1, 2, 3])
  return g
}

/**
 * Texel grid for one segment: every texture column, and the texture rows that fall inside
 * this segment (rows per segment can be fractional), slightly in front of the plane.
 */
function segGridGeometry(w: number, len: number, cols: number, rowsPerSeg: number, seg: number) {
  const pts: number[] = []
  const z = 0.015
  for (let i = 0; i <= cols; i++) {
    const x = -w / 2 + (i * w) / cols
    pts.push(x, 0, z, x, -len, z)
  }
  const top = seg * rowsPerSeg
  for (let r = Math.ceil(top); r <= top + rowsPerSeg + 1e-6; r++) {
    const y = -((r - top) / rowsPerSeg) * len
    pts.push(-w / 2, y, z, w / 2, y, z)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
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
  private gridMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
  private gridOn = false
  selectedId: string | null = null
  showOutlines = true

  constructor(private head: THREE.Group) {}

  get meshes(): THREE.Mesh[] {
    return [...this.entries.values()].flatMap((e) => (e.root.visible ? e.strands.flatMap((s) => s.meshes) : []))
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
      const shapeSame = e && e.plane.w === p.w && e.plane.h === p.h && e.plane.segments === p.segments && hairOpts(e.plane).strands === hairOpts(p).strands && e.plane.img.w === p.img.w && e.plane.img.h === p.img.h
      if (e && shapeSame) {
        if (e.plane.img !== p.img) {
          e.tex.dispose()
          e.tex = makeTexture(p.img)
          e.mat.map = e.tex
        }
        e.plane = p
        const o = hairOpts(p)
        e.strands.forEach((st, i) => {
          st.sim.side = p.side
          st.sim.phys = livePhys(p.phys, o.hang)
          st.sim.extra = { flutter: o.flutter, ...strandVariation(i, e.strands.length) }
        })
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
    const o = hairOpts(p)
    const n = o.strands
    const sw = p.w / n
    const len = p.h / p.segments
    const strands: Strand[] = []
    for (let j = 0; j < n; j++) {
      const st: Strand = { segs: [], meshes: [], outline: [], grids: [], sim: new HairSim(p.segments, p.side, livePhys(p.phys, o.hang), { flutter: o.flutter, ...strandVariation(j, n) }) }
      const holder = new THREE.Group()
      holder.position.x = -p.w / 2 + (j + 0.5) * sw
      root.add(holder)
      let parent: THREE.Object3D = holder
      for (let i = 0; i < p.segments; i++) {
        const g = new THREE.Group()
        g.position.y = i === 0 ? 0 : -len
        const m = new THREE.Mesh(segGeometry(sw, len, i / p.segments, (i + 1) / p.segments, j / n, (j + 1) / n), mat)
        m.userData = { hairId: p.id, seg: i } satisfies HairMeshInfo
        m.renderOrder = 1
        const ol = new THREE.LineSegments(outlineGeometry(sw, len), this.outlineMat)
        const gr = new THREE.LineSegments(segGridGeometry(sw, len, p.img.w / n, p.img.h / p.segments, i), this.gridMat)
        gr.visible = this.gridOn
        gr.renderOrder = 2
        st.grids.push(gr)
        g.add(m, ol, gr)
        parent.add(g)
        parent = g
        st.segs.push(g)
        st.meshes.push(m)
        st.outline.push(ol)
      }
      strands.push(st)
    }
    this.head.add(root)
    const e: Entry = { plane: p, root, strands, tex, mat }
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

  /** Texel grid on every plane (follows the editor's Grid button). */
  setGrid(on: boolean, dark: boolean) {
    this.gridOn = on
    this.gridMat.color.set(dark ? 0xffffff : 0x000000)
    for (const e of this.entries.values()) for (const st of e.strands) for (const g of st.grids) g.visible = on
  }

  refreshOutlines() {
    for (const e of this.entries.values()) {
      const sel = e.plane.id === this.selectedId
      for (const o of e.strands.flatMap((st) => st.outline)) {
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
    for (const e of this.entries.values()) for (const st of e.strands) st.sim.step(m)
  }

  /** Apply interpolated physics angles; outward swing = rotate the lower edge towards local +Z. */
  applyPhysics(alpha: number, on: boolean) {
    for (const e of this.entries.values()) {
      // the rest curve is spread evenly over the segments (outward = lower edge towards +Z)
      const curl = (hairOpts(e.plane).curl * D2R) / e.plane.segments
      for (const st of e.strands)
        st.segs.forEach((g, i) => {
          const [out, roll] = on ? st.sim.sample(i, alpha) : [0, 0]
          g.rotation.set(-(out + curl), 0, roll)
        })
    }
  }

  disposeAll() {
    for (const e of this.entries.values()) this.dispose(e)
    this.entries.clear()
    this.outlineMat.dispose()
    this.gridMat.dispose()
    this.selectedMat.dispose()
  }
}

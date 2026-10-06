import * as THREE from 'three'
import { cuboids, PARTS, type CuboidDef, type FaceName, type PartId, type Variant } from '../skin/layout'
import type { Img } from '../skin/pixels'

type V3 = [number, number, number]

/** Minecraft-like directional face shading baked into vertex colours. */
const SHADE: Record<FaceName, number> = { top: 1, front: 1, back: 0.86, right: 0.8, left: 0.8, bottom: 0.66 }
const NORMAL: Record<FaceName, V3> = { top: [0, 1, 0], bottom: [0, -1, 0], right: [-1, 0, 0], left: [1, 0, 0], front: [0, 0, 1], back: [0, 0, -1] }

/** Position on a face for texture coords (s right, t down), both 0..1. */
function facePoint(name: FaceName, lo: V3, hi: V3, s: number, t: number): V3 {
  const [x0, y0, z0] = lo
  const [x1, y1, z1] = hi
  const X = (k: number) => x0 + k * (x1 - x0)
  const Y = y1 - t * (y1 - y0)
  switch (name) {
    case 'front': return [X(s), Y, z1]
    case 'back': return [x1 - s * (x1 - x0), Y, z0]
    case 'right': return [x0, Y, z0 + s * (z1 - z0)]
    case 'left': return [x1, Y, z1 - s * (z1 - z0)]
    case 'top': return [X(s), y1, z0 + t * (z1 - z0)]
    // like Minecraft: the bottom texture's top row is at the back (same as the top face)
    case 'bottom': return [X(s), y0, z0 + t * (z1 - z0)]
  }
}

function bounds(c: CuboidDef, extra = 0): [V3, V3] {
  const i = c.inflate + extra
  return [
    [c.min[0] - i, c.min[1] - i, c.min[2] - i],
    [c.min[0] + c.size[0] + i, c.min[1] + c.size[1] + i, c.min[2] + c.size[2] + i]
  ]
}

const SIDES: FaceName[] = ['front', 'back', 'left', 'right']

/**
 * Geometry with 2 triangles per face in face order, so raycast faceIndex>>1 = face index.
 * With `bend`, the sides of arms, legs and the body are split at half height and every vertex
 * gets a bend weight ("bw": 0 = fixed half, 0.5 = the joint, 1 = the half that folds), like
 * bendy-lib. Only for posing: split faces break the faceIndex mapping painting relies on.
 */
export function cuboidGeometry(c: CuboidDef, bend = false): THREE.BufferGeometry {
  const [lo, hi] = bounds(c)
  const split = bend && c.part !== 'head'
  const upperFolds = c.part === 'body' // the body folds its top half; limbs fold the bottom half
  const pos: number[] = [], uv: number[] = [], col: number[] = [], nor: number[] = [], idx: number[] = [], bw: number[] = []
  let b = 0
  const quad = (f: CuboidDef['faces'][number], t0: number, t1: number) => {
    const corners: [number, number][] = [[0, t0], [1, t0], [0, t1], [1, t1]]
    const p = corners.map(([s, t]) => facePoint(f.name, lo, hi, s, t))
    corners.forEach(([s, t], k) => {
      pos.push(...p[k])
      uv.push((f.rect.x + s * f.rect.w) / 64, (f.rect.y + t * f.rect.h) / 64)
      col.push(SHADE[f.name], SHADE[f.name], SHADE[f.name])
      nor.push(...NORMAL[f.name])
      const down = f.name === 'top' ? 0 : f.name === 'bottom' ? 1 : t // 0 at the top .. 1 at the bottom
      bw.push(upperFolds ? 1 - down : down)
    })
    // pick the winding whose geometric normal points outward
    const e1 = new THREE.Vector3(...p[2]).sub(new THREE.Vector3(...p[0]))
    const e2 = new THREE.Vector3(...p[1]).sub(new THREE.Vector3(...p[0]))
    const outward = new THREE.Vector3().crossVectors(e1, e2).dot(new THREE.Vector3(...NORMAL[f.name])) > 0
    if (outward) idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
    else idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
    b += 4
  }
  for (const f of c.faces) {
    if (split && SIDES.includes(f.name)) {
      quad(f, 0, 0.5)
      quad(f, 0.5, 1)
    } else quad(f, 0, 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  if (split) g.setAttribute('bw', new THREE.Float32BufferAttribute(bw, 1))
  g.setIndex(idx)
  return g
}

/** Pixel grid lines (one per texel at the current resolution) floating just above each face. */
/** Skins up to this size get a grid coloured per pixel edge (finer ones use the blended grid). */
const COLOR_GRID_MAX = 256

function gridGeometry(c: CuboidDef, res: number): THREE.BufferGeometry {
  const [lo, hi] = bounds(c, 0.02)
  const pts: number[] = []
  const k = res / 64
  // per pixel edge: the two texels on either side (-1 outside the face), to colour the line
  const pairs: number[] = []
  const perEdge = res <= COLOR_GRID_MAX
  for (const f of c.faces) {
    const w = f.rect.w * k
    const h = f.rect.h * k
    const x0 = f.rect.x * k, y0 = f.rect.y * k
    const tex = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : (y0 + y) * res + x0 + x)
    if (!perEdge) {
      for (let i = 0; i <= w; i++) pts.push(...facePoint(f.name, lo, hi, i / w, 0), ...facePoint(f.name, lo, hi, i / w, 1))
      for (let j = 0; j <= h; j++) pts.push(...facePoint(f.name, lo, hi, 0, j / h), ...facePoint(f.name, lo, hi, 1, j / h))
      continue
    }
    for (let i = 0; i <= w; i++)
      for (let j = 0; j < h; j++) {
        pts.push(...facePoint(f.name, lo, hi, i / w, j / h), ...facePoint(f.name, lo, hi, i / w, (j + 1) / h))
        pairs.push(tex(i - 1, j), tex(i, j))
      }
    for (let j = 0; j <= h; j++)
      for (let i = 0; i < w; i++) {
        pts.push(...facePoint(f.name, lo, hi, i / w, j / h), ...facePoint(f.name, lo, hi, (i + 1) / w, j / h))
        pairs.push(tex(i, j - 1), tex(i, j))
      }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  if (perEdge) {
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pts.length), 3))
    g.userData.pairs = Int32Array.from(pairs)
  }
  return g
}

/**
 * Colour each grid edge from the pixels beside it: a dark line next to light pixels (skin tones),
 * a light line next to dark ones, so the grid shows on any colour.
 */
function colorGrid(g: THREE.BufferGeometry, data: Uint8Array | Uint8ClampedArray) {
  const pairs = g.userData.pairs as Int32Array | undefined
  const col = g.getAttribute('color') as THREE.BufferAttribute | undefined
  if (!pairs || !col) return
  const arr = col.array as Float32Array
  for (let e = 0; e < pairs.length / 2; e++) {
    let sum = 0, n = 0
    for (const t of [pairs[e * 2], pairs[e * 2 + 1]]) {
      if (t < 0) continue
      const a = data[t * 4 + 3]
      if (a < 40) continue
      sum += data[t * 4] * 0.299 + data[t * 4 + 1] * 0.587 + data[t * 4 + 2] * 0.114
      n++
    }
    // no painted pixel beside it (an empty outer layer): a neutral grey
    const v = n === 0 ? 0.55 : sum / n > 135 ? 0.08 : 0.95
    arr.fill(v, e * 6, e * 6 + 6)
  }
  col.needsUpdate = true
}

/** Outline of the X=0 symmetry plane drawn over the head, body and between the legs. */
function mirrorGeometry(): THREE.BufferGeometry {
  const e = 0.6 // sits just outside the overlay layer
  const pts = [
    // head: front, top, back
    [0, 24 - e, 4 + e], [0, 32 + e, 4 + e],
    [0, 32 + e, 4 + e], [0, 32 + e, -4 - e],
    [0, 32 + e, -4 - e], [0, 24 - e, -4 - e],
    // body + legs: front and back
    [0, 0, 2 + e], [0, 24, 2 + e],
    [0, 0, -2 - e], [0, 24, -2 - e],
    // under the feet
    [0, -0.05, 2 + e], [0, -0.05, -2 - e]
  ].flat()
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

/** Joint positions (model px) — same pivots the game uses, so animations bend correctly. */
export const PIVOTS: Record<PartId, [number, number, number]> = {
  head: [0, 24, 0],
  body: [0, 24, 0],
  rightArm: [-5, 22, 0],
  leftArm: [5, 22, 0],
  rightLeg: [-2, 12, 0],
  leftLeg: [2, 12, 0]
}

export interface MeshInfo {
  cuboid: number
  key: string
  kind: 'base' | 'overlay'
}

export class SkinModel {
  readonly group = new THREE.Group()
  /** One group per body part, placed at its joint; rotate these to pose the model. */
  readonly parts = Object.fromEntries(
    PARTS.map((p) => {
      const g = new THREE.Group()
      g.position.set(...PIVOTS[p])
      g.name = p
      return [p, g]
    })
  ) as Record<PartId, THREE.Group>
  meshes: THREE.Mesh[] = []
  private grids: THREE.LineSegments[] = []
  texture: THREE.DataTexture
  private baseMat: THREE.MeshBasicMaterial
  private overlayMat: THREE.MeshBasicMaterial
  // exclusion blend: dark lines on light skin, light lines on dark skin, whatever the theme
  // per-edge colours (dark on light pixels, light on dark), for skins up to 256 px
  private gridEdgeMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false })
  private gridMat = new THREE.LineBasicMaterial({ color: 0x808080, transparent: true, opacity: 1, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneMinusDstColorFactor, blendDst: THREE.OneMinusSrcColorFactor })
  private gridOn = false
  private gridTarget: 'auto' | 'base' | 'overlay' = 'auto'
  private hidden: Record<string, boolean> = {}
  private variant: Variant
  private res: number
  /** Limbs and body split at the joints so poses can bend them (pose mode). */
  private bendable = false
  private bent = new Set<PartId>()
  /** Accent-coloured lines marking the X=0 mirror plane on the model surface. */
  readonly mirrorLines: THREE.LineSegments

  constructor(img: Img, variant: Variant) {
    this.texture = this.makeTexture(img)
    this.baseMat = new MeshBasicMaterialEx(this.texture, false)
    this.overlayMat = new MeshBasicMaterialEx(this.texture, true)
    this.variant = variant
    this.res = img.w
    this.mirrorLines = new THREE.LineSegments(
      mirrorGeometry(),
      new THREE.LineBasicMaterial({ color: 0x3fd6e3 })
    )
    this.mirrorLines.renderOrder = 3
    this.mirrorLines.visible = false
    this.group.add(this.mirrorLines)
    for (const g of Object.values(this.parts)) this.group.add(g)
    this.build(variant)
  }

  private makeTexture(img: Img) {
    const t = new THREE.DataTexture(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.length), img.w, img.h, THREE.RGBAFormat)
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.generateMipmaps = false
    t.flipY = false
    t.colorSpace = THREE.SRGBColorSpace
    t.needsUpdate = true
    return t
  }

  /** Point at a new composite buffer (e.g. after a resolution change). */
  setImage(img: Img) {
    const cur = this.texture.image as { data: Uint8Array; width: number }
    if (cur.data.buffer === img.data.buffer && cur.width === img.w) {
      this.texture.needsUpdate = true
      this.recolorGrid()
      return
    }
    const old = this.texture
    this.texture = this.makeTexture(img)
    this.baseMat.map = this.texture
    this.overlayMat.map = this.texture
    old.dispose()
    if (img.w !== this.res) {
      this.res = img.w
      this.build(this.variant)
    }
  }

  refresh() {
    this.texture.needsUpdate = true
    this.recolorGrid()
  }

  /** Re-colour the per-pixel grid from the current skin (only while the grid is shown). */
  private recolorGrid() {
    if (!this.gridOn) return
    const data = (this.texture.image as { data: Uint8Array }).data
    for (const g of this.grids) colorGrid(g.geometry, data)
  }

  build(variant: Variant) {
    this.variant = variant
    // fine textures (above 256) get a soft blended grid; smaller ones colour each edge
    this.gridMat.color.setScalar(0.3)
    for (const o of [...this.meshes, ...this.grids]) {
      o.removeFromParent()
      o.geometry.dispose()
    }
    this.meshes = []
    this.grids = []
    cuboids(variant).forEach((c, i) => {
      const geo = cuboidGeometry(c, this.bendable)
      const m = new THREE.Mesh(geo, c.kind === 'base' ? this.baseMat : this.overlayMat)
      m.userData = { cuboid: i, key: c.key, kind: c.kind } satisfies MeshInfo
      if (geo.getAttribute('bw')) {
        m.userData.part = c.part
        m.userData.rest = new Float32Array(geo.getAttribute('position').array as Float32Array)
        m.userData.joint = new THREE.Vector3(c.min[0] + c.size[0] / 2, c.min[1] + c.size[1] / 2, c.min[2] + c.size[2] / 2)
      }
      m.renderOrder = c.kind === 'overlay' ? 1 : 0
      const part = this.parts[c.part]
      m.position.set(-PIVOTS[c.part][0], -PIVOTS[c.part][1], -PIVOTS[c.part][2])
      this.meshes.push(m)
      part.add(m)
      const geo2 = gridGeometry(c, this.res)
      const g = new THREE.LineSegments(geo2, geo2.userData.pairs ? this.gridEdgeMat : this.gridMat)
      g.renderOrder = 2
      g.position.copy(m.position)
      this.grids.push(g)
      part.add(g)
    })
    this.applyVisibility()
    this.recolorGrid()
  }

  /** Back to the neutral standing pose. */
  resetPose() {
    for (const p of PARTS) {
      this.parts[p].rotation.set(0, 0, 0)
      this.parts[p].position.set(...PIVOTS[p])
    }
    this.group.position.set(0, 0, 0)
    this.group.quaternion.identity()
    for (const p of [...this.bent]) this.setBend(p, 0, 0)
  }

  /** Split limbs at the joints (pose mode) or go back to plain boxes (painting). */
  setBendable(on: boolean) {
    if (on === this.bendable) return
    this.bendable = on
    this.bent.clear()
    this.build(this.variant)
  }

  /**
   * Fold a part like bendy-lib: the lower half of a limb (upper half of the body) turns by
   * `angle` about a horizontal axis through the joint; `axis` turns that axis about the limb.
   */
  setBend(part: PartId, angle: number, axis: number) {
    if (!this.bendable) return
    const dir = new THREE.Vector3(Math.cos(axis), 0, -Math.sin(axis))
    const q = new THREE.Quaternion()
    const v = new THREE.Vector3()
    for (const m of this.meshes) {
      if (m.userData.part !== part) continue
      const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute
      const bw = m.geometry.getAttribute('bw') as THREE.BufferAttribute
      const rest = m.userData.rest as Float32Array
      const joint = m.userData.joint as THREE.Vector3
      for (let i = 0; i < pos.count; i++) {
        const w = bw.getX(i)
        v.set(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2])
        if (w && angle) v.sub(joint).applyQuaternion(q.setFromAxisAngle(dir, angle * w)).add(joint)
        pos.setXYZ(i, v.x, v.y, v.z)
      }
      pos.needsUpdate = true
      m.geometry.computeBoundingSphere()
    }
    if (angle) this.bent.add(part)
    else this.bent.delete(part)
  }

  setHidden(hidden: Record<string, boolean>) {
    this.hidden = hidden
    this.applyVisibility()
  }

  /** Grid per shell: Auto shows both, Base / Overlay only the shell being painted. */
  setGrid(on: boolean, dark: boolean, target: 'auto' | 'base' | 'overlay' = this.gridTarget) {
    this.gridOn = on
    this.gridTarget = target
    void dark // the line colour comes from the skin under it, not the theme
    this.applyVisibility()
    this.recolorGrid()
  }

  setMirror(on: boolean, color: string) {
    this.mirrorLines.visible = on
    ;(this.mirrorLines.material as THREE.LineBasicMaterial).color.set(color)
  }

  private applyVisibility() {
    this.meshes.forEach((m, i) => {
      m.visible = !this.hidden[(m.userData as MeshInfo).key]
      const kind = (m.userData as MeshInfo).kind
      // Auto shows both shells (inner and outer layer); Base / Overlay show only that shell
      this.grids[i].visible = this.gridOn && m.visible && (this.gridTarget === 'auto' || (kind === 'overlay') === (this.gridTarget === 'overlay'))
    })
  }

  dispose() {
    for (const o of [...this.meshes, ...this.grids]) o.geometry.dispose()
    this.baseMat.dispose()
    this.overlayMat.dispose()
    this.gridMat.dispose()
    this.gridEdgeMat.dispose()
    this.mirrorLines.geometry.dispose()
    ;(this.mirrorLines.material as THREE.Material).dispose()
    this.texture.dispose()
  }
}

class MeshBasicMaterialEx extends THREE.MeshBasicMaterial {
  constructor(map: THREE.Texture, overlay: boolean) {
    super({
      map,
      vertexColors: true,
      transparent: overlay,
      alphaTest: 0.02,
      side: overlay ? THREE.DoubleSide : THREE.FrontSide
    })
  }
}

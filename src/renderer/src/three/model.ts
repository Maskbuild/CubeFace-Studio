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

/** Geometry with 2 triangles per face in face order, so raycast faceIndex>>1 = face index. */
export function cuboidGeometry(c: CuboidDef): THREE.BufferGeometry {
  const [lo, hi] = bounds(c)
  const pos: number[] = [], uv: number[] = [], col: number[] = [], nor: number[] = [], idx: number[] = []
  c.faces.forEach((f, fi) => {
    const corners: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]]
    const p = corners.map(([s, t]) => facePoint(f.name, lo, hi, s, t))
    corners.forEach(([s, t], k) => {
      pos.push(...p[k])
      uv.push((f.rect.x + s * f.rect.w) / 64, (f.rect.y + t * f.rect.h) / 64)
      col.push(SHADE[f.name], SHADE[f.name], SHADE[f.name])
      nor.push(...NORMAL[f.name])
    })
    const b = fi * 4
    // pick the winding whose geometric normal points outward
    const e1 = new THREE.Vector3(...p[2]).sub(new THREE.Vector3(...p[0]))
    const e2 = new THREE.Vector3(...p[1]).sub(new THREE.Vector3(...p[0]))
    const outward = new THREE.Vector3().crossVectors(e1, e2).dot(new THREE.Vector3(...NORMAL[f.name])) > 0
    if (outward) idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
    else idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setIndex(idx)
  return g
}

/** Pixel grid lines (one per texel at the current resolution) floating just above each face. */
function gridGeometry(c: CuboidDef, res: number): THREE.BufferGeometry {
  const [lo, hi] = bounds(c, 0.02)
  const pts: number[] = []
  const k = res / 64
  for (const f of c.faces) {
    const w = f.rect.w * k
    const h = f.rect.h * k
    for (let i = 0; i <= w; i++) pts.push(...facePoint(f.name, lo, hi, i / w, 0), ...facePoint(f.name, lo, hi, i / w, 1))
    for (let j = 0; j <= h; j++) pts.push(...facePoint(f.name, lo, hi, 0, j / h), ...facePoint(f.name, lo, hi, 1, j / h))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
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
  private gridMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
  private gridOn = false
  private gridTarget: 'auto' | 'base' | 'overlay' = 'auto'
  private hidden: Record<string, boolean> = {}
  private variant: Variant
  private res: number
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
  }

  build(variant: Variant) {
    this.variant = variant
    // denser grids get fainter so high-resolution skins stay readable
    this.gridMat.opacity = this.res <= 64 ? 0.3 : this.res <= 256 ? 0.2 : 0.12
    for (const o of [...this.meshes, ...this.grids]) {
      o.removeFromParent()
      o.geometry.dispose()
    }
    this.meshes = []
    this.grids = []
    cuboids(variant).forEach((c, i) => {
      const m = new THREE.Mesh(cuboidGeometry(c), c.kind === 'base' ? this.baseMat : this.overlayMat)
      m.userData = { cuboid: i, key: c.key, kind: c.kind } satisfies MeshInfo
      m.renderOrder = c.kind === 'overlay' ? 1 : 0
      const part = this.parts[c.part]
      m.position.set(-PIVOTS[c.part][0], -PIVOTS[c.part][1], -PIVOTS[c.part][2])
      this.meshes.push(m)
      part.add(m)
      const g = new THREE.LineSegments(gridGeometry(c, this.res), this.gridMat)
      g.renderOrder = 2
      g.position.copy(m.position)
      this.grids.push(g)
      part.add(g)
    })
    this.applyVisibility()
  }

  /** Back to the neutral standing pose. */
  resetPose() {
    for (const g of Object.values(this.parts)) g.rotation.set(0, 0, 0)
    this.group.position.y = 0
  }

  setHidden(hidden: Record<string, boolean>) {
    this.hidden = hidden
    this.applyVisibility()
  }

  /** Grid is drawn only on the shell being painted, so lines sit on the pixels you edit. */
  setGrid(on: boolean, dark: boolean, target: 'auto' | 'base' | 'overlay' = this.gridTarget) {
    this.gridOn = on
    this.gridTarget = target
    this.gridMat.color.set(dark ? 0xffffff : 0x000000)
    this.applyVisibility()
  }

  setMirror(on: boolean, color: string) {
    this.mirrorLines.visible = on
    ;(this.mirrorLines.material as THREE.LineBasicMaterial).color.set(color)
  }

  private applyVisibility() {
    this.meshes.forEach((m, i) => {
      m.visible = !this.hidden[(m.userData as MeshInfo).key]
      const kind = (m.userData as MeshInfo).kind
      this.grids[i].visible = this.gridOn && m.visible && (kind === 'overlay') === (this.gridTarget === 'overlay')
    })
  }

  dispose() {
    for (const o of [...this.meshes, ...this.grids]) o.geometry.dispose()
    this.baseMat.dispose()
    this.overlayMat.dispose()
    this.gridMat.dispose()
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

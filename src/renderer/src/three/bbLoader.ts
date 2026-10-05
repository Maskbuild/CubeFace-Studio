import * as THREE from 'three'

/*
 * Minimal Blockbench (.bbmodel, generic model) renderer for previewing Figura avatars.
 * Geometry is built in Blockbench space (front = north = -Z); the returned root is turned
 * 180° so the avatar faces the camera like the editor's own model.
 * Face UV orientation follows the mapping verified against real Figura avatars.
 */

type V3 = [number, number, number]
type Any = Record<string, any>
type Dir = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'

const D2R = Math.PI / 180

/** Corner positions (in from/to space) for each face, in uv order TL, TR, BL, BR. */
function faceCorners(d: Dir, lo: V3, hi: V3): V3[] {
  const [x0, y0, z0] = lo
  const [x1, y1, z1] = hi
  switch (d) {
    case 'north': return [[x1, y1, z0], [x0, y1, z0], [x1, y0, z0], [x0, y0, z0]]
    case 'south': return [[x0, y1, z1], [x1, y1, z1], [x0, y0, z1], [x1, y0, z1]]
    case 'east': return [[x1, y1, z1], [x1, y1, z0], [x1, y0, z1], [x1, y0, z0]]
    case 'west': return [[x0, y1, z0], [x0, y1, z1], [x0, y0, z0], [x0, y0, z1]]
    case 'up': return [[x0, y1, z0], [x1, y1, z0], [x0, y1, z1], [x1, y1, z1]]
    case 'down': return [[x0, y0, z0], [x1, y0, z0], [x0, y0, z1], [x1, y0, z1]]
  }
}

export interface LoadedModel {
  root: THREE.Group
  dispose(): void
  textureNames: string[]
}

/**
 * Build a model. `textureFor(tex)` returns an image source (data URL) for a texture entry,
 * or null when it can't be found (drawn magenta).
 */
export async function loadBBModel(json: Any, textureFor: (t: Any) => Promise<string | null>): Promise<LoadedModel> {
  const resW = json.resolution?.width ?? 16
  const resH = json.resolution?.height ?? 16
  const loader = new THREE.TextureLoader()
  const disposables: { dispose(): void }[] = []

  const materials: THREE.Material[] = []
  for (const t of (json.textures ?? []) as Any[]) {
    const src = await textureFor(t)
    let mat: THREE.Material
    if (src) {
      const tex = await loader.loadAsync(src)
      tex.magFilter = tex.minFilter = THREE.NearestFilter
      tex.generateMipmaps = false
      tex.flipY = false
      tex.colorSpace = THREE.SRGBColorSpace
      disposables.push(tex)
      mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide })
    } else mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, side: THREE.DoubleSide })
    disposables.push(mat)
    materials.push(mat)
  }
  const uvSize = (ti: number): [number, number] => {
    const t = (json.textures ?? [])[ti] as Any | undefined
    return [t?.uv_width ?? resW, t?.uv_height ?? resH]
  }

  const elements = new Map<string, Any>((json.elements ?? []).map((e: Any) => [e.uuid, e]))
  const groupProps = new Map<string, Any>((json.groups ?? []).map((g: Any) => [g.uuid, g]))

  /** Geometry for one element, positions relative to `pivot`. */
  const buildElement = (e: Any, pivot: V3): THREE.Object3D | null => {
    if (e.visibility === false || e.export === false) return null
    const origin: V3 = e.origin ?? [0, 0, 0]
    const holder = new THREE.Group()
    holder.position.set(origin[0] - pivot[0], origin[1] - pivot[1], origin[2] - pivot[2])
    const rot: V3 = e.rotation ?? [0, 0, 0]
    holder.rotation.set(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R, 'ZYX')
    const byTex = new Map<number, { pos: number[]; uv: number[]; idx: number[] }>()
    const bucket = (ti: number) => {
      let b = byTex.get(ti)
      if (!b) byTex.set(ti, (b = { pos: [], uv: [], idx: [] }))
      return b
    }
    if (e.type === 'mesh') {
      const verts = e.vertices as Record<string, V3>
      for (const f of Object.values(e.faces ?? {}) as Any[]) {
        if (f.texture === null || f.texture === undefined || !materials[f.texture]) continue
        const ids: string[] = f.vertices
        if (ids.length < 3) continue
        const [uw, uh] = uvSize(f.texture)
        const b = bucket(f.texture)
        const base = b.pos.length / 3
        for (const id of ids) {
          b.pos.push(...verts[id])
          const uv = f.uv?.[id] ?? [0, 0]
          b.uv.push(uv[0] / uw, uv[1] / uh)
        }
        b.idx.push(base, base + 1, base + 2)
        if (ids.length === 4) b.idx.push(base, base + 2, base + 3)
      }
    } else if (!e.type || e.type === 'cube') {
      const inf = e.inflate ?? 0
      const lo: V3 = [e.from[0] - inf - origin[0], e.from[1] - inf - origin[1], e.from[2] - inf - origin[2]]
      const hi: V3 = [e.to[0] + inf - origin[0], e.to[1] + inf - origin[1], e.to[2] + inf - origin[2]]
      for (const d of ['north', 'south', 'east', 'west', 'up', 'down'] as Dir[]) {
        const f = e.faces?.[d] as Any | undefined
        if (!f || f.texture === null || f.texture === undefined || !materials[f.texture]) continue
        const [uw, uh] = uvSize(f.texture)
        const [u1, v1, u2, v2] = f.uv as number[]
        // uv corners TL, TR, BL, BR, then turned in 90° steps for face rotation
        let uvs: [number, number][] = [[u1, v1], [u2, v1], [u1, v2], [u2, v2]]
        const turns = (((f.rotation ?? 0) / 90) % 4 + 4) % 4
        for (let i = 0; i < turns; i++) uvs = [uvs[2], uvs[0], uvs[3], uvs[1]]
        const b = bucket(f.texture)
        const base = b.pos.length / 3
        faceCorners(d, lo, hi).forEach((p, i) => {
          b.pos.push(...p)
          b.uv.push(uvs[i][0] / uw, uvs[i][1] / uh)
        })
        b.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
      }
    } else return null
    for (const [ti, b] of byTex) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2))
      g.setIndex(b.idx)
      disposables.push(g)
      holder.add(new THREE.Mesh(g, materials[ti]))
    }
    return holder
  }

  /** Outliner node: an element uuid, or a group (v5: {uuid, children}; v4: full group). */
  const buildNode = (node: string | Any, pivot: V3): THREE.Object3D | null => {
    if (typeof node === 'string') {
      const e = elements.get(node)
      return e ? buildElement(e, pivot) : null
    }
    const g = { ...(groupProps.get(node.uuid) ?? {}), ...node }
    if (g.visibility === false || g.export === false) return null
    const origin: V3 = g.origin ?? [0, 0, 0]
    const obj = new THREE.Group()
    obj.name = g.name ?? ''
    obj.position.set(origin[0] - pivot[0], origin[1] - pivot[1], origin[2] - pivot[2])
    const rot: V3 = g.rotation ?? [0, 0, 0]
    obj.rotation.set(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R, 'ZYX')
    for (const c of g.children ?? []) {
      const child = buildNode(c, origin)
      if (child) obj.add(child)
    }
    return obj
  }

  const inner = new THREE.Group()
  for (const n of json.outliner ?? []) {
    const o = buildNode(n, [0, 0, 0])
    if (o) inner.add(o)
  }
  const root = new THREE.Group()
  root.rotation.y = Math.PI
  root.add(inner)
  return {
    root,
    textureNames: (json.textures ?? []).map((t: Any) => t.name ?? ''),
    dispose: () => disposables.forEach((d) => d.dispose())
  }
}

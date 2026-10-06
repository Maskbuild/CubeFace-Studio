import * as THREE from 'three'
import type { McElement, McFaceName, McItem, McModel, McPack } from './pack'

/*
 * Inventory-style icons for Minecraft items, drawn from the models/textures in an McPack:
 * flat items composite their layers; block items are rendered in 3D with the model's GUI
 * transform and Minecraft-like face shading.
 */

const strip = (s: string) => s.replace(/^minecraft:/, '')

interface Resolved {
  textures: Record<string, string>
  elements?: McElement[]
  gui?: { rotation?: number[]; translation?: number[]; scale?: number[] }
  kind: 'flat' | 'model' | 'entity'
}

export function resolveModel(pack: McPack, ref: string): Resolved {
  const chain: McModel[] = []
  let cur: string | undefined = strip(ref)
  let kind: Resolved['kind'] = 'model'
  for (let guard = 0; cur && guard < 32; guard++) {
    if (cur === 'builtin/generated') {
      kind = 'flat'
      break
    }
    if (cur === 'builtin/entity') {
      kind = 'entity'
      break
    }
    const m: McModel | undefined = pack.models[cur]
    if (!m) break
    chain.push(m)
    cur = m.parent ? strip(m.parent) : undefined
  }
  const textures: Record<string, string> = {}
  for (let i = chain.length - 1; i >= 0; i--) Object.assign(textures, chain[i].textures ?? {})
  const elements = chain.find((m) => m.elements)?.elements
  const gui = chain.find((m) => m.display?.gui)?.display?.gui
  // a model that defines its own elements is drawn in 3D even under item/generated
  if (kind === 'flat' && chain.findIndex((m) => m.elements) !== -1) kind = 'model'
  if (kind === 'model' && !elements) kind = textures.layer0 ? 'flat' : 'entity'
  return { textures, elements, gui, kind }
}

const texRef = (map: Record<string, string>, ref: string | undefined): string | null => {
  for (let i = 0; ref && i < 8; i++) {
    if (!ref.startsWith('#')) return strip(ref)
    ref = map[ref.slice(1)]
  }
  return null
}

// ---- images ----------------------------------------------------------------------------------
const images = new Map<string, Promise<HTMLImageElement | null>>()
function image(pack: McPack, path: string | null): Promise<HTMLImageElement | null> {
  if (!path || !pack.textures[path]) return Promise.resolve(null)
  const key = pack.version + ':' + path
  let p = images.get(key)
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = 'data:image/png;base64,' + pack.textures[path]
    })
    images.set(key, p)
  }
  return p
}

const hex = (n: number) => '#' + (n & 0xffffff).toString(16).padStart(6, '0')

/** Layered flat icon (first animation frame), tinted per layer like the game does. */
async function drawFlat(pack: McPack, r: Resolved, item: McItem, size: number): Promise<string | null> {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  let drawn = false
  for (let i = 0; i < 8; i++) {
    const path = texRef(r.textures, r.textures['layer' + i] ?? (i === 0 && r.kind === 'entity' ? r.textures.particle : undefined))
    if (!path) break
    const img = await image(pack, path)
    if (!img) continue
    const s = img.width // animated textures are vertical strips of square frames
    const tint = item.tints?.[i]
    if (tint !== undefined && tint !== 0xffffff && tint !== -1) {
      const t = document.createElement('canvas')
      t.width = t.height = size
      const tg = t.getContext('2d')!
      tg.imageSmoothingEnabled = false
      tg.drawImage(img, 0, 0, s, s, 0, 0, size, size)
      tg.globalCompositeOperation = 'multiply'
      tg.fillStyle = hex(tint)
      tg.fillRect(0, 0, size, size)
      tg.globalCompositeOperation = 'destination-in'
      tg.drawImage(img, 0, 0, s, s, 0, 0, size, size)
      g.drawImage(t, 0, 0)
    } else g.drawImage(img, 0, 0, s, s, 0, 0, size, size)
    drawn = true
  }
  return drawn ? c.toDataURL() : null
}

// ---- 3D block models -----------------------------------------------------------------------------
let renderer: THREE.WebGLRenderer | null = null
function getRenderer(size: number) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
  }
  renderer.setSize(size, size, false)
  return renderer
}

type V = [number, number, number]
/** Face corners TL, TR, BR, BL as seen from outside (Minecraft's texture orientation). */
function corners(f: McFaceName, a: number[], b: number[]): V[] {
  const [x0, y0, z0] = a
  const [x1, y1, z1] = b
  switch (f) {
    case 'north': return [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]]
    case 'south': return [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]]
    case 'east': return [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]]
    case 'west': return [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]]
    case 'up': return [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]
    case 'down': return [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]]
  }
}
function defaultUV(f: McFaceName, a: number[], b: number[]): number[] {
  switch (f) {
    case 'north': return [16 - b[0], 16 - b[1], 16 - a[0], 16 - a[1]]
    case 'south': return [a[0], 16 - b[1], b[0], 16 - a[1]]
    case 'east': return [16 - b[2], 16 - b[1], 16 - a[2], 16 - a[1]]
    case 'west': return [a[2], 16 - b[1], b[2], 16 - a[1]]
    case 'up': return [a[0], a[2], b[0], b[2]]
    case 'down': return [a[0], 16 - b[2], b[0], 16 - a[2]]
  }
}
const NORMAL: Record<McFaceName, V> = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] }

async function drawModel(pack: McPack, r: Resolved, item: McItem, size: number): Promise<string | null> {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  const gui = r.gui ?? {}
  const D = Math.PI / 180
  const rot = gui.rotation ?? [0, 0, 0]
  const tr = gui.translation ?? [0, 0, 0]
  const sc = gui.scale ?? [1, 1, 1]
  root.position.set(tr[0] / 16, tr[1] / 16, tr[2] / 16)
  root.rotation.set(rot[0] * D, rot[1] * D, rot[2] * D, 'XYZ')
  root.scale.set(sc[0], sc[1], sc[2])
  scene.add(root)
  const view = new THREE.Quaternion().setFromEuler(root.rotation)
  const textures: THREE.Texture[] = []
  const texCache = new Map<string, { tex: THREE.Texture; frame: number } | null>()
  const getTex = async (path: string | null) => {
    if (!path) return null
    if (!texCache.has(path)) {
      const img = await image(pack, path)
      if (!img) texCache.set(path, null)
      else {
        const tex = new THREE.Texture(img)
        tex.magFilter = tex.minFilter = THREE.NearestFilter
        tex.generateMipmaps = false
        tex.colorSpace = THREE.SRGBColorSpace
        tex.needsUpdate = true
        textures.push(tex)
        texCache.set(path, { tex, frame: img.width / img.height })
      }
    }
    return texCache.get(path)!
  }
  let faces = 0
  for (const el of r.elements ?? []) {
    const m = new THREE.Matrix4()
    if (el.rotation && el.rotation.angle) {
      const o = new THREE.Vector3(...(el.rotation.origin.map((v) => v / 16 - 0.5) as V))
      const ax = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }[el.rotation.axis]
      const k = el.rotation.rescale ? 1 / Math.cos(Math.abs(el.rotation.angle) * D) : 1
      const s = new THREE.Vector3(el.rotation.axis === 'x' ? 1 : k, el.rotation.axis === 'y' ? 1 : k, el.rotation.axis === 'z' ? 1 : k)
      m.makeTranslation(o.x, o.y, o.z)
        .multiply(new THREE.Matrix4().makeRotationAxis(ax, el.rotation.angle * D))
        .multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z))
        .multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z))
    }
    const nm = new THREE.Matrix3().getNormalMatrix(m)
    for (const [fname, face] of Object.entries(el.faces) as [McFaceName, NonNullable<McElement['faces'][McFaceName]>][]) {
      const t = await getTex(texRef(r.textures, face.texture))
      if (!t) continue
      const uv = face.uv ?? defaultUV(fname, el.from, el.to)
      const cs = corners(fname, el.from, el.to).map((p) => new THREE.Vector3(p[0] / 16 - 0.5, p[1] / 16 - 0.5, p[2] / 16 - 0.5).applyMatrix4(m))
      // uv corners TL, TR, BR, BL; face rotation turns the texture clockwise
      let uvs: [number, number][] = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]]
      const steps = (((face.rotation ?? 0) / 90) % 4 + 4) % 4
      for (let i = 0; i < steps; i++) uvs = [uvs[3], uvs[0], uvs[1], uvs[2]]
      const n = new THREE.Vector3(...NORMAL[fname]).applyMatrix3(nm).normalize().applyQuaternion(view)
      // Minecraft-ish GUI shading: lit from the top, left side brighter than the right
      const b = el.shade === false ? 1 : Math.min(1, Math.max(0.42, 0.78 + 0.22 * (n.y / 0.87) - 0.14 * (n.x / 0.71)))
      const tint = face.tintindex !== undefined && face.tintindex >= 0 ? item.tints?.[face.tintindex] : undefined
      const col = new THREE.Color(tint !== undefined ? hex(tint) : '#ffffff').multiplyScalar(b)
      const geo = new THREE.BufferGeometry()
      const pos = [cs[0], cs[3], cs[2], cs[0], cs[2], cs[1]].flatMap((v) => [v.x, v.y, v.z])
      const uvi = [0, 3, 2, 0, 2, 1].flatMap((i) => [uvs[i][0] / 16, 1 - (uvs[i][1] / 16) * t.frame])
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvi, 2))
      const mat = new THREE.MeshBasicMaterial({ map: t.tex, color: col, side: THREE.DoubleSide, transparent: true, alphaTest: 0.05 })
      root.add(new THREE.Mesh(geo, mat))
      faces++
    }
  }
  if (!faces) return null
  const cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -10, 10)
  cam.position.z = 5
  const rd = getRenderer(size)
  rd.render(scene, cam)
  const url = rd.domElement.toDataURL()
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose()
      ;(o.material as THREE.Material).dispose()
    }
  })
  for (const t of textures) t.dispose()
  return url
}

// ---- public -----------------------------------------------------------------------------------------
const icons = new Map<string, Promise<string | null>>()
let queue: Promise<unknown> = Promise.resolve()

/** Icon of an item as a PNG data URL (cached). Renders are queued so they never overlap. */
export function itemIcon(pack: McPack, id: string, size = 64): Promise<string | null> {
  const key = `${pack.version}:${id}:${size}`
  let p = icons.get(key)
  if (!p) {
    const item = pack.items.find((i) => i.id === strip(id))
    if (!item) return Promise.resolve(null)
    p = queue.then(async () => {
      const r = resolveModel(pack, item.model)
      try {
        return r.kind === 'model' ? ((await drawModel(pack, r, item, size)) ?? (await drawFlat(pack, r, item, size))) : await drawFlat(pack, r, item, size)
      } catch {
        return null
      }
    })
    queue = p
    icons.set(key, p)
  }
  return p
}

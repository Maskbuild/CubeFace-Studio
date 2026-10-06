import * as THREE from 'three'
import { loadBBModel, type LoadedModel } from '../three/bbLoader'
import { storage, type AvatarMeta } from './storage'

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '')
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1).toLowerCase()

/** Resolve a .bbmodel path like "../textures/skin.png" against the model's folder. */
function join(dir: string, rel: string) {
  const out: string[] = []
  for (const p of (dir + rel.replace(/\\/g, '/')).split('/')) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return out.join('/')
}

/** Load every .bbmodel of a library avatar, with textures from the model or its folder. */
export async function loadAvatarModels(avatar: AvatarMeta, files?: { path: string }[]): Promise<LoadedModel[]> {
  files ??= await storage.avatarFiles(avatar.id)
  const pngs = files.filter((f) => /\.png$/i.test(f.path))
  const out: LoadedModel[] = []
  for (const m of files.filter((f) => f.path.toLowerCase().endsWith('.bbmodel'))) {
    const text = await storage.readAvatarFile(avatar.id, m.path)
    if (!text) continue
    let json
    try {
      json = JSON.parse(text)
    } catch {
      continue
    }
    const dir = dirOf(m.path)
    out.push(
      await loadBBModel(json, async (tex) => {
        if (typeof tex.source === 'string' && tex.source.startsWith('data:')) return tex.source
        const tries = [tex.relative_path && join(dir, tex.relative_path), tex.name && join(dir, tex.name)].filter(Boolean) as string[]
        const hit = tries.find((p) => pngs.some((f) => f.path === p)) ?? pngs.find((f) => base(f.path) === String(tex.name ?? '').toLowerCase())?.path
        return hit ? storage.readAvatarFile(avatar.id, hit) : null
      })
    )
  }
  return out
}

let renderer: THREE.WebGLRenderer | null = null

/** 3/4 view of an avatar's models as a PNG data URL (null when it has no model). */
export async function renderAvatarThumb(avatar: AvatarMeta, size = 256): Promise<string | null> {
  const models = await loadAvatarModels(avatar)
  if (!models.length) return null
  renderer ??= new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(size, size, false)
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  for (const m of models) scene.add(m.root)
  const box = new THREE.Box3()
  for (const m of models) box.expandByObject(m.root)
  if (box.isEmpty()) return null
  const s = box.getBoundingSphere(new THREE.Sphere())
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 2000)
  cam.position.copy(s.center).add(new THREE.Vector3(-0.45, 0.2, 1).normalize().multiplyScalar(s.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.02))
  cam.lookAt(s.center)
  renderer.render(scene, cam)
  const url = renderer.domElement.toDataURL('image/png')
  models.forEach((m) => m.dispose())
  return url
}

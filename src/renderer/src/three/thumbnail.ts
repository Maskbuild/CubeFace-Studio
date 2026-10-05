import * as THREE from 'three'
import type { Variant } from '../skin/layout'
import type { Img } from '../skin/pixels'
import { SkinModel } from './model'

let renderer: THREE.WebGLRenderer | null = null

/** Render a 3/4 front view of a skin to a PNG data URL (shared offscreen renderer). */
export function renderThumbnail(img: Img, variant: Variant, size = 256): string {
  renderer ??= new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(size, size, false)
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  const model = new SkinModel(img, variant)
  model.group.position.y = -16
  model.group.rotation.y = -0.45
  scene.add(model.group)
  const cam = new THREE.PerspectiveCamera(30, 1, 1, 200)
  cam.position.set(0, 4, 72)
  cam.lookAt(0, 0, 0)
  renderer.render(scene, cam)
  const url = renderer.domElement.toDataURL('image/png')
  model.dispose()
  return url
}

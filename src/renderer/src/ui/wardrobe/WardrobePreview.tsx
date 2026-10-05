import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Variant } from '../../skin/layout'
import type { HairPlane } from '../../skin/hair'
import type { Img } from '../../skin/pixels'
import { SkinModel } from '../../three/model'
import { HairRig } from '../../three/hairRig'

/** Stand-alone 3D viewer: left-drag rotates, wheel zooms (towards the cursor), right-drag pans. */
export function WardrobePreview({ img, variant, hair }: { img: Img; variant: Variant; hair: HairPlane[] }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const live = useRef<{ model: SkinModel; rig: HairRig; variant: Variant; invalidate(): void } | null>(null)

  useEffect(() => {
    const box = boxRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    box.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const model = new SkinModel(img, variant)
    scene.add(model.group)
    const rig = new HairRig(model.parts.head)
    rig.showOutlines = false
    const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 500)
    camera.position.set(0, 20, 70)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 16, 0)
    controls.enableDamping = true
    controls.zoomToCursor = true
    controls.minDistance = 10
    controls.maxDistance = 140
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault())

    let dirty = true
    controls.addEventListener('change', () => (dirty = true))
    live.current = { model, rig, variant, invalidate: () => (dirty = true) }

    let raf = 0, w = 0, h = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      if (box.clientWidth !== w || box.clientHeight !== h) {
        w = box.clientWidth
        h = box.clientHeight
        renderer.setSize(w, h, false)
        camera.aspect = w / Math.max(1, h)
        camera.updateProjectionMatrix()
        dirty = true
      }
      controls.update()
      if (!dirty) return
      dirty = false
      renderer.render(scene, camera)
    }
    frame()
    return () => {
      cancelAnimationFrame(raf)
      controls.dispose()
      rig.disposeAll()
      model.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      live.current = null
    }
    // the scene is created once; prop changes are pushed in by the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const l = live.current
    if (!l) return
    l.model.setImage(img)
    l.model.refresh()
    if (l.variant !== variant) {
      l.variant = variant
      l.model.build(variant)
    }
    l.rig.sync(hair)
    l.invalidate()
  }, [img, variant, hair])

  return <div className="wardrobe-preview" ref={boxRef} />
}

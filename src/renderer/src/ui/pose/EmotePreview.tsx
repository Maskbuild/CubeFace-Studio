import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { SkinModel } from '../../three/model'
import { mannequin } from '../../skin/templates'
import type { Img } from '../../skin/pixels'
import type { Variant } from '../../skin/layout'
import { applyPose } from '../../pose/apply'
import { emoteLength, sampleEmote, type Emote } from '../../pose/emote'

/** Small turntable that plays an emote on a skin (the mannequin by default). */
export function EmotePreview({ emote, skin, variant = 'wide', playing = true, spin = true }: { emote: Emote | null; skin?: Img; variant?: Variant; playing?: boolean; spin?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const state = useRef({ emote, playing, spin })
  state.current = { emote, playing, spin }

  useEffect(() => {
    const el = box.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const model = new SkinModel(skin ?? mannequin(64, variant), variant)
    model.setBendable(true)
    scene.add(model.group)
    const floor = new THREE.GridHelper(48, 12, 0x888888, 0x888888)
    ;(floor.material as THREE.Material).transparent = true
    ;(floor.material as THREE.Material).opacity = 0.18
    scene.add(floor)
    const cam = new THREE.PerspectiveCamera(32, 1, 1, 400)
    let t = 0
    let last = performance.now()
    let raf = 0
    let current: Emote | null = null
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const now = performance.now()
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const { emote: e, playing: p, spin } = state.current
      if (e !== current) {
        current = e
        t = 0
      }
      if (e) {
        if (p) t += dt * 20
        // one-shot emotes start over after a short pause
        if (!e.loop && t > emoteLength(e) + 20) t = 0
        applyPose(model, sampleEmote(e, t))
      } else model.resetPose()
      const w = el.clientWidth, h = el.clientHeight
      renderer.setSize(w, h, false)
      cam.aspect = w / Math.max(1, h)
      cam.updateProjectionMatrix()
      const a = spin ? (now / 1000) * 0.35 + 0.6 : 0.6
      cam.position.set(Math.sin(a) * 86, 30, Math.cos(a) * 86)
      cam.lookAt(0, 13, 0)
      renderer.render(scene, cam)
    }
    frame()
    return () => {
      cancelAnimationFrame(raf)
      model.dispose()
      floor.geometry.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [skin, variant])

  return <div className="emote-preview" ref={box} />
}

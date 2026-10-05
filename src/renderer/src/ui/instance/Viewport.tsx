import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { faceRect, type Rect } from '../../skin/layout'
import { SkinModel, type MeshInfo } from '../../three/model'
import { HairRig, type HairMeshInfo } from '../../three/hairRig'
import { MotionDriver } from '../../three/motion'
import { PaintSession } from '../../lib/paint'
import { useEditor } from '../../store/editor'
import { Toolbar } from './Toolbar'

const MINI = { w: 170, h: 230, margin: 12 }
const HOME_POS = new THREE.Vector3(0, 22, 58)
const TARGET = new THREE.Vector3(0, 16, 0)

function isDark() {
  return getComputedStyle(document.documentElement).colorScheme === 'dark'
}

export function Viewport({ doc }: { doc: SkinDoc }) {
  const { t } = useTranslation()
  const boxRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const api = useRef<{ resetView(): void } | null>(null)
  const preview = useEditor((s) => s.preview)

  useEffect(() => {
    const box = boxRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setScissorTest(true)
    box.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const model = new SkinModel(doc.composite, doc.variant)
    scene.add(model.group)
    const floor = new THREE.GridHelper(48, 12, 0x888888, 0x888888)
    ;(floor.material as THREE.Material).transparent = true
    ;(floor.material as THREE.Material).opacity = 0.18
    scene.add(floor)

    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 500)
    camera.position.copy(HOME_POS)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(TARGET)
    controls.enableDamping = true
    controls.dampingFactor = 0.18
    controls.minDistance = 8
    controls.maxDistance = 160
    controls.zoomToCursor = true

    const miniCam = new THREE.PerspectiveCamera(30, MINI.w / MINI.h, 1, 300)

    // ---- hair planes + physics preview --------------------------------------------------
    const rig = new HairRig(model.parts.head)
    const driver = new MotionDriver()
    const gizmo = new TransformControls(camera, renderer.domElement)
    gizmo.setSize(0.7)
    const gizmoHelper = gizmo.getHelper()
    scene.add(gizmoHelper)
    gizmo.addEventListener('dragging-changed', (e) => {
      controls.enabled = !e.value
      // commit the new position as one undo step when the drag ends
      if (!e.value && doc.hairId && gizmo.object) {
        const o = gizmo.object.position
        const r = (n: number) => Math.round(n * 4) / 4
        doc.updateHair(doc.hairId, { pos: [r(o.x), r(o.y), r(o.z)] })
      }
    })
    gizmo.addEventListener('change', () => (dirty = true))
    const syncHair = () => {
      const s = useEditor.getState()
      rig.sync(s.figura ? doc.hair : [])
      rig.selectedId = doc.hairId
      rig.showOutlines = s.hairOutlines
      rig.refreshOutlines()
      const root = doc.hairId && s.figura && s.motion === 'off' ? rig.root(doc.hairId) : undefined
      if (root) gizmo.attach(root)
      else gizmo.detach()
      gizmoHelper.visible = !!root
      driver.mode = s.figura ? s.motion : 'off'
      if (driver.mode !== 'off') model.mirrorLines.visible = false // the guide doesn't follow the animated head
      if (driver.mode === 'off') {
        model.resetPose()
        rig.applyPhysics(0, false)
      }
    }

    // ---- state sync --------------------------------------------------------------------
    let dirty = true
    const sync = () => {
      const s = useEditor.getState()
      model.setHidden(s.hidden)
      model.setGrid(s.grid, isDark(), s.target)
      model.setMirror(s.mirror, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3fd6e3')
      const orbit = s.tool === 'orbit'
      controls.mouseButtons = { LEFT: orbit ? THREE.MOUSE.ROTATE : (null as unknown as THREE.MOUSE), MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
      renderer.domElement.style.cursor = orbit ? 'grab' : s.tool === 'picker' ? 'copy' : 'crosshair'
      rig.setAccent(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3fd6e3')
      syncHair()
      dirty = true
    }
    sync()
    const unsubStore = useEditor.subscribe(sync)

    let variant = doc.variant
    const unsubDoc = doc.on((e) => {
      if (e.type === 'hair') rig.textureChanged(e.id)
      else if (e.type === 'structure') {
        syncHair()
        model.setImage(doc.composite)
        if (doc.variant !== variant) {
          variant = doc.variant
          model.build(variant)
          sync()
        }
      } else model.refresh()
      dirty = true
    })

    // ---- picking -----------------------------------------------------------------------
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    type Hit = { x: number; y: number; clip: Rect; hairId: string | null }
    const hitTexel = (ev: PointerEvent, only?: 'skin' | string): Hit | null => {
      const r = renderer.domElement.getBoundingClientRect()
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const s = useEditor.getState()
      const targets = [...(only === 'skin' ? [] : rig.meshes), ...(only && only !== 'skin' ? [] : model.meshes.filter((m) => m.visible && m.parent?.visible !== false))]
      for (const hit of ray.intersectObjects(targets, false)) {
        const hinfo = hit.object.userData as Partial<HairMeshInfo>
        if (hinfo.hairId) {
          if (only && only !== hinfo.hairId) continue
          const h = doc.hairPlane(hinfo.hairId)
          if (!h) continue
          const x = Math.min(h.img.w - 1, Math.max(0, Math.floor(hit.uv!.x * h.img.w)))
          const y = Math.min(h.img.h - 1, Math.max(0, Math.floor(hit.uv!.y * h.img.h)))
          // see through empty hair pixels unless this plane is selected (so blank planes can be painted)
          if (!only && h.id !== doc.hairId && h.img.data[(y * h.img.w + x) * 4 + 3] === 0) continue
          return { x, y, clip: { x: 0, y: 0, w: h.img.w, h: h.img.h }, hairId: h.id }
        }
        const info = hit.object.userData as MeshInfo
        if (s.target === 'base' && info.kind !== 'base') continue
        if (s.target === 'overlay' && info.kind !== 'overlay') continue
        const clip = faceRect(doc.variant, doc.res, { cuboid: info.cuboid, face: Math.floor(hit.faceIndex! / 2) })
        const x = Math.min(clip.x + clip.w - 1, Math.max(clip.x, Math.floor(hit.uv!.x * doc.res)))
        const y = Math.min(clip.y + clip.h - 1, Math.max(clip.y, Math.floor(hit.uv!.y * doc.res)))
        // In auto mode, see through transparent overlay pixels to the base layer underneath.
        if (s.target === 'auto' && info.kind === 'overlay' && doc.composite.data[(y * doc.res + x) * 4 + 3] === 0) continue
        return { x, y, clip, hairId: null }
      }
      return null
    }

    const session = new PaintSession(doc)
    let spaceOrbit = false
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0 || useEditor.getState().tool === 'orbit' || spaceOrbit || gizmo.axis !== null) return
      const hit = hitTexel(ev)
      if (!hit) return
      if (session.down(hit.x, hit.y, hit.clip, hit.hairId)) renderer.domElement.setPointerCapture(ev.pointerId)
    }
    const onMove = (ev: PointerEvent) => {
      if (!session.active) return
      const hit = hitTexel(ev, session.strokeHair ?? 'skin')
      if (hit) session.move(hit.x, hit.y, hit.clip)
    }
    const onUp = () => session.up()
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointercancel', onUp)
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault())

    // Hold Space to orbit with the left mouse button
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).tagName === 'INPUT') return
      e.preventDefault()
      const on = e.type === 'keydown'
      if (on === spaceOrbit) return
      spaceOrbit = on
      controls.mouseButtons.LEFT = on ? THREE.MOUSE.ROTATE : useEditor.getState().tool === 'orbit' ? THREE.MOUSE.ROTATE : (null as unknown as THREE.MOUSE)
      renderer.domElement.style.cursor = on ? 'grab' : ''
      if (!on) sync()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)

    controls.addEventListener('change', () => (dirty = true))
    api.current = {
      resetView() {
        camera.position.copy(HOME_POS)
        controls.target.copy(TARGET)
        controls.update()
      }
    }

    // ---- render loop -------------------------------------------------------------------
    let raf = 0
    let w = 0, h = 0
    const t0 = performance.now()
    let last = performance.now()
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const now = performance.now()
      if (driver.mode !== 'off') {
        const alpha = driver.update((now - last) / 1000, model, (m) => rig.tick(m))
        rig.applyPhysics(alpha, true)
        dirty = true
      }
      last = now
      const cw = box.clientWidth, ch = box.clientHeight
      if (cw !== w || ch !== h) {
        w = cw
        h = ch
        renderer.setSize(w, h, false)
        camera.aspect = w / Math.max(1, h)
        camera.updateProjectionMatrix()
        dirty = true
      }
      controls.update()
      const showMini = useEditor.getState().preview && w > 400
      if (frameRef.current) frameRef.current.style.display = showMini ? '' : 'none'
      if (!dirty && !showMini) return
      dirty = false
      floor.visible = true
      renderer.setViewport(0, 0, w, h)
      renderer.setScissor(0, 0, w, h)
      renderer.render(scene, camera)
      if (showMini) {
        // full-body turntable preview, independent of the main camera zoom
        const a = ((performance.now() - t0) / 1000) * 0.6
        miniCam.position.set(Math.sin(a) * 78, 20, Math.cos(a) * 78)
        miniCam.lookAt(0, 16, 0)
        const x = w - MINI.w - MINI.margin, y = MINI.margin
        renderer.setViewport(x, y, MINI.w, MINI.h)
        renderer.setScissor(x, y, MINI.w, MINI.h)
        floor.visible = false
        const grid = useEditor.getState().grid
        const mirror = model.mirrorLines.visible
        model.setGrid(false, false)
        model.mirrorLines.visible = false
        gizmoHelper.visible = false
        renderer.render(scene, miniCam)
        gizmoHelper.visible = !!gizmo.object
        model.setGrid(grid, isDark())
        model.mirrorLines.visible = mirror
      }
    }
    frame()

    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => sync()
    mq.addEventListener('change', onScheme)
    const themeObs = new MutationObserver(sync)
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] })

    return () => {
      cancelAnimationFrame(raf)
      unsubStore()
      unsubDoc()
      mq.removeEventListener('change', onScheme)
      themeObs.disconnect()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      gizmo.detach()
      gizmo.dispose()
      controls.dispose()
      rig.disposeAll()
      model.dispose()
      floor.geometry.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [doc])

  return (
    <div className="viewport">
      <Toolbar onResetView={() => api.current?.resetView()} />
      <div className="canvas3d" ref={boxRef}>
        {preview && (
          <div className="mini-frame" ref={frameRef}>
            <span className="label">{t('tools.preview')}</span>
          </div>
        )}
        <div className="hint-bar">{t('tools.hint')}</div>
      </div>
    </div>
  )
}

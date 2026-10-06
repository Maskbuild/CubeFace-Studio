import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { cuboids, faceRect, type Rect } from '../../skin/layout'
import { usedCuboids } from '../../skin/usage'
import { SkinModel, type MeshInfo } from '../../three/model'
import { HairRig, type HairMeshInfo } from '../../three/hairRig'
import { MotionDriver } from '../../three/motion'
import { FiguraRig } from '../../three/figuraRig'
import type { Keyword, LoadedModel } from '../../three/bbLoader'
import type { PartId } from '../../skin/layout'
import { loadAvatarModels } from '../../lib/avatarModels'
import { storage } from '../../lib/storage'
import { PaintSession } from '../../lib/paint'
import { useEditor } from '../../store/editor'
import { Toolbar } from './Toolbar'
import { applyPose, limbAngles } from '../../pose/apply'
import { emoteLength, sampleEmote, type Bone, type PoseState } from '../../pose/emote'
import { usePoseClock } from '../../pose/library'

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

    /** Bounding sphere of the painted parts (a head-only skin frames just the head). */
    const contentSphere = () => {
      const used = usedCuboids(doc.composite, doc.variant)
      const box = new THREE.Box3()
      cuboids(doc.variant).forEach((c, i) => {
        if (!used[i]) return
        box.expandByPoint(new THREE.Vector3(...c.min))
        box.expandByPoint(new THREE.Vector3(c.min[0] + c.size[0], c.min[1] + c.size[1], c.min[2] + c.size[2]))
      })
      if (box.isEmpty()) box.set(new THREE.Vector3(-8, 0, -4), new THREE.Vector3(8, 32, 4))
      return box.getBoundingSphere(new THREE.Sphere())
    }
    let framed = contentSphere()
    const frameView = () => {
      framed = contentSphere()
      const dist = Math.max(14, (framed.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05)
      const dir = HOME_POS.clone().sub(TARGET).normalize()
      controls.target.copy(framed.center)
      camera.position.copy(framed.center).addScaledVector(dir, dist)
      controls.update()
    }

    // ---- hair planes + physics preview --------------------------------------------------
    const rig = new HairRig(model.parts.head)
    const fig = new FiguraRig(model.parts.head)

    // library avatars used with this skin; their Figura keyword groups follow the skin's parts
    const attachedRoot = new THREE.Group()
    model.group.add(attachedRoot)
    let attachedKey = ''
    let attachedModels: LoadedModel[] = []
    const PART_OF: Record<Keyword, PartId> = { Head: 'head', Body: 'body', RightArm: 'rightArm', LeftArm: 'leftArm', RightLeg: 'rightLeg', LeftLeg: 'leftLeg' }
    const tmpQ = new THREE.Quaternion()
    /** Models are built in Blockbench space (turned 180° about Y): mirror the rotation's x/z. */
    const poseAttached = () => {
      for (const m of attachedModels)
        for (const k of Object.keys(m.keywords) as Keyword[]) {
          const q = model.parts[PART_OF[k]].quaternion
          tmpQ.set(-q.x, q.y, -q.z, q.w)
          for (const g of m.keywords[k]) g.quaternion.copy(g.userData.rest as THREE.Quaternion).multiply(tmpQ)
        }
    }
    const syncAttached = (show: boolean) => {
      attachedRoot.visible = show
      const ids = doc.figura.attached.filter((a) => a.enabled).map((a) => a.id)
      const key = ids.join()
      if (key === attachedKey) return
      attachedKey = key
      ;(async () => {
        const metas = await storage.listAvatars()
        const loaded: LoadedModel[] = []
        for (const id of ids) {
          const m = metas.find((x) => x.id === id)
          if (m) loaded.push(...(await loadAvatarModels(m).catch(() => [])))
        }
        // a newer selection may have started while loading
        if (key !== attachedKey) return loaded.forEach((x) => x.dispose())
        attachedModels.forEach((x) => (x.root.removeFromParent(), x.dispose()))
        attachedModels = loaded
        for (const x of loaded) attachedRoot.add(x.root)
        dirty = true
      })()
    }
    const smoothHead = new THREE.Quaternion()
    let smoothInit = false
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

    // ---- pose mode: rotate the selected part with a gizmo --------------------------------
    const poseGizmo = new TransformControls(camera, renderer.domElement)
    poseGizmo.setMode('rotate')
    poseGizmo.setSpace('local')
    poseGizmo.setSize(0.8)
    const poseHelper = poseGizmo.getHelper()
    scene.add(poseHelper)
    poseGizmo.addEventListener('dragging-changed', (e) => (controls.enabled = !e.value))
    poseGizmo.addEventListener('objectChange', () => {
      const s = useEditor.getState()
      const bone = s.poseBone
      if (!bone || bone === 'body' || !poseGizmo.object) return
      const a = limbAngles(poseGizmo.object.quaternion)
      s.set({ pose: { ...s.pose, [bone]: { ...s.pose[bone], ...a } } })
    })
    const posing = () => useEditor.getState().mode === 'pose'
    const syncHair = () => {
      const s = useEditor.getState()
      rig.sync(s.figura ? doc.hair : [])
      rig.selectedId = doc.hairId
      rig.showOutlines = s.hairOutlines
      rig.setGrid(s.grid, isDark())
      rig.refreshOutlines()
      const pose = s.mode === 'pose'
      model.setBendable(pose)
      // the pose gizmo turns limbs and the head (the whole body uses the sliders)
      const bonePart = pose && !s.emote && s.poseBone && s.poseBone !== 'body' && s.poseBone !== 'torso' ? model.parts[s.poseBone] : undefined
      if (bonePart) poseGizmo.attach(bonePart)
      else poseGizmo.detach()
      poseHelper.visible = !!bonePart
      const root = doc.hairId && s.figura && s.motion === 'off' && !pose ? rig.root(doc.hairId) : undefined
      if (root) gizmo.attach(root)
      else gizmo.detach()
      gizmoHelper.visible = !!root
      fig.enabled = s.figura && s.mode === 'figura'
      fig.expr = s.figExpr
      fig.editFrame = doc.faceFrame
      fig.talk = s.figTalk
      fig.sync(doc)
      syncAttached(s.figura)
      driver.mode = pose ? 'off' : s.motion
      if (driver.mode !== 'off' || pose) model.mirrorLines.visible = false // the guide doesn't follow the animated head
      if (driver.mode === 'off' && !pose) {
        model.resetPose()
        rig.applyPhysics(0, false)
      }
    }

    // ---- state sync --------------------------------------------------------------------
    let dirty = true
    const sync = () => {
      const s = useEditor.getState()
      model.setHidden(s.hidden)
      model.setGrid(s.grid && s.mode !== 'pose', isDark(), s.target)
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
      else if (e.type === 'face') fig.textureChanged(e.frame)
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
    type Hit = { x: number; y: number; clip: Rect; hairId: string | null; face?: boolean }
    const hitTexel = (ev: PointerEvent, only?: 'skin' | 'face' | string): Hit | null => {
      const r = renderer.domElement.getBoundingClientRect()
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const s = useEditor.getState()
      // while a face frame is selected in Figura mode, the head front paints that frame
      const editFace = !!doc.faceFrame && (!only || only === 'face')
      const targets = [...(only === 'skin' || only === 'face' ? [] : rig.meshes), ...(only && only !== 'skin' && only !== 'face' ? [] : model.meshes.filter((m) => m.visible && m.parent?.visible !== false))]
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
        if (editFace) {
          const cub = cuboids(doc.variant)[info.cuboid]
          const fi = Math.floor(hit.faceIndex! / 2)
          // another part of the model: no face hit (on click, the caller leaves face mode)
          if (cub.part !== 'head' || cub.faces[fi].name !== 'front') return null
          const r = faceRect(doc.variant, doc.res, { cuboid: info.cuboid, face: fi })
          const x = Math.min(r.w - 1, Math.max(0, Math.floor(hit.uv!.x * doc.res) - r.x))
          const y = Math.min(r.h - 1, Math.max(0, Math.floor(hit.uv!.y * doc.res) - r.y))
          return { x, y, clip: { x: 0, y: 0, w: r.w, h: r.h }, hairId: null, face: true }
        }
        if (s.target === 'base' && info.kind !== 'base') continue
        if (s.target === 'overlay' && info.kind !== 'overlay') continue
        const clip = faceRect(doc.variant, doc.res, { cuboid: info.cuboid, face: Math.floor(hit.faceIndex! / 2) })
        const x = Math.min(clip.x + clip.w - 1, Math.max(clip.x, Math.floor(hit.uv!.x * doc.res)))
        const y = Math.min(clip.y + clip.h - 1, Math.max(clip.y, Math.floor(hit.uv!.y * doc.res)))
        // In auto mode, see through transparent overlay pixels to the base layer underneath.
        // Auto paints the body (inner layer) first; the outer layer only where the inner part is hidden
        if (s.target === 'auto' && info.kind === 'overlay' && !s.hidden[info.key.replace('overlay', 'base')]) continue
        return { x, y, clip, hairId: null }
      }
      return null
    }

    const session = new PaintSession(doc)
    let spaceOrbit = false
    const PART_BONE: Record<string, Bone> = { head: 'head', body: 'body', rightArm: 'rightArm', leftArm: 'leftArm', rightLeg: 'rightLeg', leftLeg: 'leftLeg' }
    const pickBone = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect()
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const hit = ray.intersectObjects(model.meshes.filter((m) => m.visible), false)[0]
      useEditor.getState().set({ poseBone: hit ? PART_BONE[hit.object.parent?.name ?? ''] ?? null : null })
    }
    const onDown = (ev: PointerEvent) => {
      if (posing()) {
        if (ev.button === 0 && !spaceOrbit && poseGizmo.axis === null) pickBone(ev)
        return
      }
      if (ev.button !== 0 || useEditor.getState().tool === 'orbit' || spaceOrbit || gizmo.axis !== null) return
      let hit = hitTexel(ev)
      // clicking anything but the face while a face frame is selected leaves face painting
      if (doc.faceFrame && !hit?.face) {
        doc.selectFace(null)
        hit = hitTexel(ev)
      }
      if (!hit) return
      // the selection follows what you click: a hair plane selects itself, the skin deselects hair
      if (!hit.hairId && doc.hairId) doc.selectHair(null)
      if (session.down(hit.x, hit.y, hit.clip, hit.hairId, !!hit.face)) renderer.domElement.setPointerCapture(ev.pointerId)
    }
    const onMove = (ev: PointerEvent) => {
      if (!session.active) return
      const hit = hitTexel(ev, session.strokeHair ?? (doc.faceFrame ? 'face' : 'skin'))
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
    api.current = { resetView: frameView }
    /** Render the current view to a transparent PNG at a chosen size (pose mode "save image"). */
    const shot = (W: number, H: number) => {
      const pr = renderer.getPixelRatio()
      renderer.setPixelRatio(1)
      renderer.setSize(W, H, false)
      camera.aspect = W / H
      camera.updateProjectionMatrix()
      renderer.setViewport(0, 0, W, H)
      renderer.setScissor(0, 0, W, H)
      const hide = [floor, gizmoHelper, poseHelper].map((o) => [o, o.visible] as const)
      hide.forEach(([o]) => (o.visible = false))
      model.setGrid(false, false)
      rig.setGrid(false, false)
      renderer.render(scene, camera)
      const url = renderer.domElement.toDataURL('image/png')
      hide.forEach(([o, v]) => (o.visible = v))
      renderer.setPixelRatio(pr)
      w = h = 0 // resize back on the next frame
      sync()
      return url
    }
    useEditor.getState().set({ poseShot: shot })
    frameView()

    // ---- render loop -------------------------------------------------------------------
    let raf = 0
    let w = 0, h = 0
    const t0 = performance.now()
    let last = performance.now()
    let figAcc = 0
    let poseT = 0, poseAcc = 0, clockAt = 0
    const lastPose = { y: 0, yaw: 0 }
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const now = performance.now()
      const dt = Math.min(0.25, (now - last) / 1000)
      if (driver.mode === 'camera') {
        // head follows the camera: + yaw turns towards +X (player's left), + pitch looks down
        const d = camera.position.clone().sub(new THREE.Vector3(0, 28 + model.group.position.y, 0))
        const yaw = THREE.MathUtils.clamp(Math.atan2(d.x, d.z), -1.3, 1.3)
        const pitch = THREE.MathUtils.clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -1, 1)
        driver.cameraLook = [pitch, yaw]
      }
      let alpha = 1
      if (posing()) {
        const s = useEditor.getState()
        let state: PoseState = s.pose
        if (s.emote) {
          const clock = usePoseClock.getState()
          if (clock.seek !== null) {
            poseT = clock.seek
            usePoseClock.setState({ seek: null })
          }
          if (s.emotePlaying) poseT += dt * 20 * s.emoteSpeed
          const len = emoteLength(s.emote)
          if (!s.emote.loop && poseT >= len) {
            poseT = len
            if (s.emotePlaying) s.set({ emotePlaying: false })
          }
          state = sampleEmote(s.emote, poseT)
          if (now - clockAt > 90) {
            clockAt = now
            usePoseClock.setState({ tick: s.emote.loop ? poseT % Math.max(1, s.emote.endTick) : poseT })
          }
        } else poseT = 0
        applyPose(model, state)
        // hair follows the head: one physics step per game tick
        poseAcc += dt
        while (poseAcc >= 0.05) {
          poseAcc -= 0.05
          const head = state.head ?? {}
          const body = state.body ?? {}
          const yaw = (head.yaw ?? 0) + (body.yaw ?? 0)
          const y = body.y ?? 0
          rig.tick({ vx: 0, vy: y - lastPose.y, vz: 0, pitch: (head.pitch ?? 0) + (body.pitch ?? 0), yawRate: lastPose.yaw - yaw })
          lastPose.y = y
          lastPose.yaw = yaw
        }
        rig.applyPhysics(poseAcc / 0.05, true)
        dirty = true
      } else if (driver.mode !== 'off') {
        alpha = driver.update(dt, model, (m) => rig.tick(m))
        rig.applyPhysics(alpha, true)
        dirty = true
      }
      if (fig.enabled || fig.editFrame) {
        const cfg = doc.figura
        // the Figura preview runs its own 20 Hz clock for blinking / talking
        figAcc += dt
        while (figAcc >= 0.05) {
          figAcc -= 0.05
          fig.tick(doc)
        }
        fig.updateEyes(doc, model.parts.head)
        // smooth head: the head lags behind where the animation points it
        const head = model.parts.head
        if (cfg.smoothHead && driver.mode !== 'off' && !posing()) {
          if (!smoothInit) smoothHead.copy(head.quaternion), (smoothInit = true)
          smoothHead.slerp(head.quaternion, 1 - Math.pow(1 - cfg.headSpeed, dt * 20))
          head.quaternion.copy(smoothHead)
        } else smoothInit = false
        dirty = true
      }
      if (attachedModels.length && attachedRoot.visible) {
        poseAttached()
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
        const md = Math.max(20, (framed.radius / Math.sin(THREE.MathUtils.degToRad(15))) * 1.05)
        miniCam.position.set(framed.center.x + Math.sin(a) * md, framed.center.y + 4, framed.center.z + Math.cos(a) * md)
        miniCam.lookAt(framed.center)
        const x = w - MINI.w - MINI.margin, y = MINI.margin
        renderer.setViewport(x, y, MINI.w, MINI.h)
        renderer.setScissor(x, y, MINI.w, MINI.h)
        floor.visible = false
        const grid = useEditor.getState().grid
        const mirror = model.mirrorLines.visible
        model.setGrid(false, false)
        rig.setGrid(false, false)
        model.mirrorLines.visible = false
        gizmoHelper.visible = false
        renderer.render(scene, miniCam)
        gizmoHelper.visible = !!gizmo.object
        model.setGrid(grid, isDark())
        rig.setGrid(grid, isDark())
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
      poseGizmo.detach()
      poseGizmo.dispose()
      if (useEditor.getState().poseShot === shot) useEditor.getState().set({ poseShot: null })
      controls.dispose()
      rig.disposeAll()
      fig.dispose()
      attachedKey = '\u0000disposed'
      attachedModels.forEach((x) => x.dispose())
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

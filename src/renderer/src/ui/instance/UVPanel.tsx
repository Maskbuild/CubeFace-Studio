import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { cuboids, faceAt, faceRect, RESOLUTIONS, scaleRect, type Variant } from '../../skin/layout'
import { commitFloating, floatingPos, liftSelection, moveFloatingTo, select } from '../../lib/selection'
import { mirrorTexel } from '../../skin/mirror'
import { faceOrigin, type FaceFrame } from '../../skin/figura'
import { frameLabel } from '../figura/frameLabel'
import type { Img } from '../../skin/pixels'
import { PaintSession } from '../../lib/paint'
import { useEditor } from '../../store/editor'
import { confirmBox } from '../common/dialogs'
import { Icon } from '../common/Icon'
import { brushOutline } from '../common/brushOutline'

export function UVPanel({ doc }: { doc: SkinDoc }) {
  const [big, setBig] = useState(false)
  const refit = useRef<() => void>(() => {})
  const { t } = useTranslation()
  useEditor((s) => s.tick)
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const box = boxRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const off = document.createElement('canvas')
    const offCtx = off.getContext('2d')!
    let imgData: ImageData | null = null
    // The panel shows the skin, the selected hair plane's texture, or a Figura face frame.
    type Src = { img: Img; hairId: string | null; face: FaceFrame | null }
    const source = (): Src => {
      const h = doc.hairPlane(doc.hairId)
      if (h) return { img: h.img, hairId: h.id, face: null }
      const f = doc.faceFrame
      const fi = f ? doc.faces[f] : undefined
      if (f && fi) return { img: fi, hairId: null, face: f }
      return { img: doc.composite, hairId: null, face: null }
    }
    // the skin itself, drawn under face frames as a painting reference
    const skinRef = document.createElement('canvas')
    const syncSkinRef = () => {
      skinRef.width = skinRef.height = doc.res
      skinRef.getContext('2d')!.putImageData(new ImageData(doc.composite.data, doc.res, doc.res), 0, 0)
    }
    let src = source()

    const view = { scale: 1, ox: 0, oy: 0, fitted: false }
    let hover: [number, number] | null = null
    let raf = 0

    const syncOffscreen = (r?: { x: number; y: number; w: number; h: number }) => {
      const next = source()
      if (next.hairId !== src.hairId || next.face !== src.face) {
        view.fitted = false
        // a selection belongs to what was being edited
        commitFloating(doc)
        select(null)
      }
      if (next.face) syncSkinRef()
      src = next
      if (!imgData || imgData.data !== src.img.data) {
        off.width = src.img.w
        off.height = src.img.h
        imgData = new ImageData(src.img.data, src.img.w, src.img.h)
        r = undefined
        view.fitted = false
      }
      if (r) offCtx.putImageData(imgData, 0, 0, r.x, r.y, r.w, r.h)
      else offCtx.putImageData(imgData, 0, 0)
    }

    refit.current = () => {
      view.fitted = false
      schedule()
    }
    const fit = () => {
      const s = Math.min(canvas.width / src.img.w, canvas.height / src.img.h) * 0.94
      view.scale = s
      view.ox = (canvas.width - src.img.w * s) / 2
      view.oy = (canvas.height - src.img.h * s) / 2
      view.fitted = true
    }

    const draw = () => {
      raf = 0
      const dpr = window.devicePixelRatio
      const w = Math.round(box.clientWidth * dpr), h = Math.round(box.clientHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        view.fitted = false
      }
      if (!view.fitted) fit()
      const css = getComputedStyle(document.documentElement)
      const { scale: s, ox, oy } = view
      const W = src.img.w, H = src.img.h
      const sw = W * s, sh = H * s
      const isSkin = !src.hairId && !src.face
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, w, h)
      // checkerboard behind the texture
      const cell = Math.max(4, s * (doc.res / 64))
      ctx.fillStyle = css.getPropertyValue('--checker-a')
      ctx.fillRect(ox, oy, sw, sh)
      ctx.fillStyle = css.getPropertyValue('--checker-b')
      ctx.save()
      ctx.beginPath()
      ctx.rect(ox, oy, sw, sh)
      ctx.clip()
      for (let y = 0, j = 0; y < sh; y += cell, j++) for (let x = (j % 2) * cell; x < sw; x += cell * 2) ctx.fillRect(ox + x, oy + y, cell, cell)
      ctx.restore()
      ctx.imageSmoothingEnabled = false
      if (src.face) {
        const o = faceOrigin(doc.res)
        ctx.globalAlpha = 0.55
        ctx.drawImage(skinRef, o.x, o.y, o.size, o.size, ox, oy, sw, sh)
        ctx.globalAlpha = 1
      }
      ctx.drawImage(off, ox, oy, sw, sh)
      if (src.face) {
        // eye / mouth guides
        const fc = doc.figura
        ctx.setLineDash([4, 3])
        ctx.lineWidth = 1.5
        ctx.strokeStyle = css.getPropertyValue('--accent')
        for (const r of [fc.eyeR, fc.eyeL, fc.mouth]) ctx.strokeRect(ox + r.x * s, oy + r.y * s, r.w * s, r.h * s)
        if (useEditor.getState().mirror) {
          ctx.beginPath()
          ctx.moveTo(ox + sw / 2, oy)
          ctx.lineTo(ox + sw / 2, oy + sh)
          ctx.stroke()
        }
        ctx.setLineDash([])
      }

      const ed = useEditor.getState()
      const lineColor = css.getPropertyValue('--text-3')
      // texel grid at the current resolution; when texels are too small on screen, every
      // 2^n-th line is drawn instead so the lines still land exactly on texel borders
      if (ed.grid) {
        let step = 1
        while (step * s < 4 && step < Math.max(W, H)) step *= 2
        const cell = step * s
        const i0 = Math.max(0, Math.floor(-ox / cell)), i1 = Math.min(Math.floor(W / step), Math.ceil((w - ox) / cell))
        const j0 = Math.max(0, Math.floor(-oy / cell)), j1 = Math.min(Math.floor(H / step), Math.ceil((h - oy) / cell))
        // difference: the line takes the opposite of the pixels under it (dark on skin tones,
        // light on dark colours), so it shows on any colour
        ctx.globalCompositeOperation = 'difference'
        ctx.strokeStyle = step === 1 ? '#a0a0a0' : '#707070'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let i = i0; i <= i1; i++) {
          const p = Math.round(ox + i * cell) + 0.5
          ctx.moveTo(p, oy)
          ctx.lineTo(p, oy + sh)
        }
        for (let j = j0; j <= j1; j++) {
          const q = Math.round(oy + j * cell) + 0.5
          ctx.moveTo(ox, q)
          ctx.lineTo(ox + sw, q)
        }
        ctx.stroke()
        ctx.globalCompositeOperation = 'source-over'
      }
      // face outlines (skin only)
      ctx.strokeStyle = lineColor
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 1
      if (!isSkin) ctx.strokeRect(Math.round(ox) + 0.5, Math.round(oy) + 0.5, Math.round(sw), Math.round(sh))
      else for (const c of cuboids(doc.variant)) {
        if (ed.hidden[c.key]) continue
        for (const f of c.faces) {
          const r = scaleRect(f.rect, doc.res)
          ctx.strokeRect(Math.round(ox + r.x * s) + 0.5, Math.round(oy + r.y * s) + 0.5, Math.round(r.w * s), Math.round(r.h * s))
        }
      }
      ctx.globalAlpha = 1
      // mirror axis: centre line of every face that mirrors onto itself (head/body, not limbs or sides)
      if (ed.mirror && isSkin) {
        ctx.strokeStyle = css.getPropertyValue('--accent')
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        for (const c of cuboids(doc.variant)) {
          if (ed.hidden[c.key] || (c.part !== 'head' && c.part !== 'body')) continue
          for (const f of c.faces) {
            if (f.name === 'left' || f.name === 'right') continue
            const r = scaleRect(f.rect, doc.res)
            const x = Math.round(ox + (r.x + r.w / 2) * s) + 0.5
            ctx.moveTo(x, oy + r.y * s)
            ctx.lineTo(x, oy + (r.y + r.h) * s)
          }
        }
        ctx.stroke()
        ctx.setLineDash([])
      }
      // selection (marching dashes) and the floating piece
      if (ed.selection) {
        const r = ed.selection
        const x = Math.round(ox + r.x * s) + 0.5, y = Math.round(oy + r.y * s) + 0.5
        ctx.lineWidth = 1.5
        ctx.setLineDash([5, 4])
        ctx.strokeStyle = '#000'
        ctx.strokeRect(x, y, Math.round(r.w * s), Math.round(r.h * s))
        ctx.lineDashOffset = 5
        ctx.strokeStyle = ed.floatingOn ? css.getPropertyValue('--accent') : '#fff'
        ctx.strokeRect(x, y, Math.round(r.w * s), Math.round(r.h * s))
        ctx.setLineDash([])
        ctx.lineDashOffset = 0
      }
      // hovered texel
      if (hover && ed.tool !== 'orbit' && ed.tool !== 'select') {
        const n = ed.tool === 'brush' ? ed.brush.size : ed.tool === 'eraser' ? ed.eraser.size : 1
        const o = -Math.floor(n / 2)
        const round = n > 2 && (ed.tool === 'brush' || ed.tool === 'eraser') && (ed.tool === 'eraser' ? ed.eraser : ed.brush).shape === 'circle'
        brushOutline(ctx, ox + (hover[0] + o) * s, oy + (hover[1] + o) * s, n * s, round, css.getPropertyValue('--accent'))
        ctx.strokeStyle = css.getPropertyValue('--accent')
        ctx.lineWidth = 1.5
        const m = ed.mirror && isSkin ? mirrorTexel(doc.variant, doc.res, hover[0], hover[1]) : null
        if (m) {
          ctx.setLineDash([3, 2])
          ctx.strokeRect(ox + (m[0] - o - n + 1) * s, oy + (m[1] + o) * s, n * s, n * s)
          ctx.setLineDash([])
        }
      }
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw)
    }

    syncOffscreen()
    schedule()
    const unsubDoc = doc.on((e) => {
      if (e.type === 'pixels' && src.hairId) return
      if (e.type === 'pixels' && src.face) {
        syncSkinRef()
        return schedule()
      }
      if (e.type === 'hair' && e.id !== src.hairId) return
      if (e.type === 'face' && e.frame !== src.face) return
      syncOffscreen(e.type === 'pixels' ? e.rect : undefined)
      schedule()
    })
    const unsubStore = useEditor.subscribe(schedule)
    const ro = new ResizeObserver(schedule)
    ro.observe(box)

    // ---- input -------------------------------------------------------------------------
    const texel = (ev: PointerEvent | WheelEvent): [number, number] => {
      const r = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio
      return [Math.floor(((ev.clientX - r.left) * dpr - view.ox) / view.scale), Math.floor(((ev.clientY - r.top) * dpr - view.oy) / view.scale)]
    }
    const session = new PaintSession(doc)
    let pan: { x: number; y: number } | null = null
    // selection tool: drawing a box, or dragging the floating piece
    let drag: { mode: 'rect'; ax: number; ay: number; moved: boolean } | { mode: 'move'; sx: number; sy: number; ox: number; oy: number } | null = null
    const clampT = (x: number, y: number): [number, number] => [Math.min(src.img.w - 1, Math.max(0, x)), Math.min(src.img.h - 1, Math.max(0, y))]
    const onSelectDown = (x: number, y: number) => {
      const ed = useEditor.getState()
      const inside = (r: { x: number; y: number; w: number; h: number } | null) => !!r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h
      const fp = floatingPos()
      if (fp && inside(fp)) return void (drag = { mode: 'move', sx: x, sy: y, ox: fp.x, oy: fp.y })
      if (!fp && inside(ed.selection) && liftSelection(doc)) {
        const f = floatingPos()!
        return void (drag = { mode: 'move', sx: x, sy: y, ox: f.x, oy: f.y })
      }
      commitFloating(doc)
      const [cx, cy] = clampT(x, y)
      drag = { mode: 'rect', ax: cx, ay: cy, moved: false }
      select({ x: cx, y: cy, w: 1, h: 1 })
    }
    const onDown = (ev: PointerEvent) => {
      try {
        canvas.setPointerCapture(ev.pointerId)
      } catch {
        // pointer already released (e.g. synthetic events)
      }
      if (ev.button === 1 || ev.button === 2 || useEditor.getState().tool === 'orbit') {
        pan = { x: ev.clientX, y: ev.clientY }
        return
      }
      if (ev.button !== 0) return
      const [x, y] = texel(ev)
      if (useEditor.getState().tool === 'select') {
        onSelectDown(x, y)
        schedule()
        return
      }
      if (x < 0 || y < 0 || x >= src.img.w || y >= src.img.h) return
      session.down(x, y, null, src.hairId, !!src.face)
    }
    const onMove = (ev: PointerEvent) => {
      if (pan) {
        const dpr = window.devicePixelRatio
        view.ox += (ev.clientX - pan.x) * dpr
        view.oy += (ev.clientY - pan.y) * dpr
        pan = { x: ev.clientX, y: ev.clientY }
        schedule()
        return
      }
      const [x, y] = texel(ev)
      hover = x >= 0 && y >= 0 && x < src.img.w && y < src.img.h ? [x, y] : null
      if (drag?.mode === 'rect') {
        const [cx, cy] = clampT(x, y)
        drag.moved ||= cx !== drag.ax || cy !== drag.ay
        select({ x: Math.min(drag.ax, cx), y: Math.min(drag.ay, cy), w: Math.abs(cx - drag.ax) + 1, h: Math.abs(cy - drag.ay) + 1 })
      } else if (drag?.mode === 'move') moveFloatingTo(doc, drag.ox + x - drag.sx, drag.oy + y - drag.sy)
      if (session.active && hover) session.move(x, y, null)
      schedule()
    }
    const onUp = (ev: PointerEvent) => {
      pan = null
      session.up()
      // a click without dragging selects the whole face under it (or nothing)
      if (drag?.mode === 'rect' && !drag.moved) {
        const [x, y] = texel(ev)
        if (src.hairId || src.face) select(null)
        else {
          const ref = x >= 0 && y >= 0 && x < doc.res && y < doc.res ? faceAt(doc.variant, doc.res, x, y) : null
          select(ref ? faceRect(doc.variant, doc.res, ref) : null)
        }
      }
      drag = null
    }
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const r = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio
      const mx = (ev.clientX - r.left) * dpr, my = (ev.clientY - r.top) * dpr
      const k = Math.exp(-ev.deltaY * 0.0015)
      const ns = Math.min(256, Math.max(0.1, view.scale * k))
      view.ox = mx - ((mx - view.ox) * ns) / view.scale
      view.oy = my - ((my - view.oy) * ns) / view.scale
      view.scale = ns
      schedule()
    }
    const onLeave = () => {
      hover = null
      schedule()
    }
    const onDbl = (ev: MouseEvent) => {
      if (ev.button === 1) {
        view.fitted = false
        schedule()
      }
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('auxclick', onDbl)
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    return () => {
      cancelAnimationFrame(raf)
      unsubDoc()
      unsubStore()
      ro.disconnect()
    }
  }, [doc])

  // fit the view again when it opens large or goes back
  useEffect(() => {
    const id = requestAnimationFrame(() => refit.current())
    return () => cancelAnimationFrame(id)
  }, [big])
  useEffect(() => {
    if (!big) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setBig(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [big])

  const changeRes = async (res: number) => {
    if (res < doc.res && !(await confirmBox(t('uv.downscale', { from: doc.res, to: res }), t('common.ok'), t('common.cancel')))) return
    doc.setResolution(res)
  }

  const hair = doc.hairPlane(doc.hairId)
  const frame = !hair && doc.faceFrame && doc.faces[doc.faceFrame] ? doc.faceFrame : null
  return (
    <>
    {big && <div className="uv-big-back" onMouseDown={() => setBig(false)} />}
    <div className={'uv-wrap' + (big ? ' uv-big' : '')}>
      <div className="section" style={{ borderBottom: 0, paddingBottom: 8 }}>
        <div className="section-head">
          <span className="label">{t('uv.title')}</span>
          <button className="btn sm-btn" title={t('uv.enlargeHint')} onClick={() => setBig(!big)}><Icon name={big ? 'x' : 'zoom'} size={13} />{big ? t('common.close') : t('figura.enlarge')}</button>
          <select className="select" style={{ height: 26 }} value={doc.res} onChange={(e) => changeRes(Number(e.target.value))}>
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>{r}×{r}</option>
            ))}
          </select>
        </div>
        {frame && (
          <div className="uv-chip">
            <span>{t('figura.frame')}: <b>{frameLabel(t, doc.figura, frame)}</b></span>
            <button className="icon-btn sm" title={t('uv.backToSkin')} onClick={() => doc.selectFace(null)}><Icon name="x" size={13} /></button>
          </div>
        )}
        {hair && (
          <div className="uv-chip">
            <span>{t('hair.title')}: <b>{hair.name}</b></span>
            <button className="icon-btn sm" title={t('uv.backToSkin')} onClick={() => doc.selectHair(null)}><Icon name="x" size={13} /></button>
          </div>
        )}
        <div className="seg" style={{ alignSelf: 'stretch' }}>
          {(['wide', 'slim'] as Variant[]).map((v) => (
            <button key={v} style={{ flex: 1 }} className={doc.variant === v ? 'on' : ''} onClick={() => doc.setVariant(v)}>{t(`model.${v}`)}</button>
          ))}
        </div>
      </div>
      <div className="uv-canvas-box" ref={boxRef}>
        <canvas ref={canvasRef} />
      </div>
    </div>
    </>
  )
}

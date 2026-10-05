import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { cuboids, RESOLUTIONS, scaleRect, type Variant } from '../../skin/layout'
import { mirrorTexel } from '../../skin/mirror'
import { PaintSession } from '../../lib/paint'
import { useEditor } from '../../store/editor'
import { confirmBox } from '../common/dialogs'
import { Icon } from '../common/Icon'

export function UVPanel({ doc }: { doc: SkinDoc }) {
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
    // The panel shows the skin, or the selected hair plane's own texture.
    const source = () => {
      const h = doc.hairPlane(doc.hairId)
      return h ? { img: h.img, hairId: h.id as string | null } : { img: doc.composite, hairId: null as string | null }
    }
    let src = source()

    const view = { scale: 1, ox: 0, oy: 0, fitted: false }
    let hover: [number, number] | null = null
    let raf = 0

    const syncOffscreen = (r?: { x: number; y: number; w: number; h: number }) => {
      const next = source()
      if (next.hairId !== src.hairId) view.fitted = false
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
      const isSkin = !src.hairId
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
      ctx.drawImage(off, ox, oy, sw, sh)

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
        ctx.strokeStyle = lineColor
        ctx.globalAlpha = step === 1 ? 0.3 : 0.18
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
        ctx.globalAlpha = 1
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
      // hovered texel
      if (hover && ed.tool !== 'orbit') {
        const n = ed.tool === 'brush' ? ed.brush.size : ed.tool === 'eraser' ? ed.eraser.size : 1
        const o = -Math.floor(n / 2)
        ctx.strokeStyle = css.getPropertyValue('--accent')
        ctx.lineWidth = 1.5
        ctx.strokeRect(ox + (hover[0] + o) * s, oy + (hover[1] + o) * s, n * s, n * s)
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
      if (e.type === 'hair' && e.id !== src.hairId) return
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
      if (x < 0 || y < 0 || x >= src.img.w || y >= src.img.h) return
      session.down(x, y, null, src.hairId)
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
      if (session.active && hover) session.move(x, y, null)
      schedule()
    }
    const onUp = () => {
      pan = null
      session.up()
    }
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const r = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio
      const mx = (ev.clientX - r.left) * dpr, my = (ev.clientY - r.top) * dpr
      const k = Math.exp(-ev.deltaY * 0.0015)
      const ns = Math.min(64, Math.max(0.1, view.scale * k))
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

  const changeRes = async (res: number) => {
    if (res < doc.res && !(await confirmBox(t('uv.downscale', { from: doc.res, to: res }), t('common.ok'), t('common.cancel')))) return
    doc.setResolution(res)
  }

  const hair = doc.hairPlane(doc.hairId)
  return (
    <div className="uv-wrap">
      <div className="section" style={{ borderBottom: 0, paddingBottom: 8 }}>
        <div className="section-head">
          <span className="label">{t('uv.title')}</span>
          <select className="select" style={{ height: 26 }} value={doc.res} onChange={(e) => changeRes(Number(e.target.value))}>
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>{r}×{r}</option>
            ))}
          </select>
        </div>
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
  )
}

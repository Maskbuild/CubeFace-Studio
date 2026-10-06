import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { allFrames, faceOrigin, type FaceFrame } from '../../skin/figura'
import { parseHex, toHex } from '../../skin/color'
import { PaintSession } from '../../lib/paint'
import { useEditor, type Tool } from '../../store/editor'
import { Icon } from '../common/Icon'
import { frameLabel } from './frameLabel'

const TOOLS: [Tool, string][] = [
  ['brush', 'brush'],
  ['eraser', 'eraser'],
  ['gradient', 'gradient'],
  ['picker', 'picker']
]

/**
 * A separate, large window for painting one face frame (expression, blink, talk or base face),
 * with the current face shown underneath. Uses the same brush settings and undo as the editor.
 */
export function FacePainter({ doc, frame: initial, onClose }: { doc: SkinDoc; frame: FaceFrame; onClose: () => void }) {
  const { t } = useTranslation()
  const ed = useEditor()
  const [frame, setFrame] = useState<FaceFrame>(initial)
  const [underlay, setUnderlay] = useState(0.5)
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frames = allFrames(doc.figura).filter((f) => doc.faces[f])
  const b = ed.tool === 'eraser' ? ed.eraser : ed.brush
  const state = useRef({ underlay, frame })
  const redraw = useRef<() => void>(() => {})
  state.current = { underlay, frame }

  // painting a frame = selecting it (the 3D view shows it too)
  useEffect(() => {
    doc.selectFace(frame)
    if (!['brush', 'eraser', 'gradient', 'picker'].includes(ed.tool)) ed.set({ tool: 'brush' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame])

  useEffect(() => {
    const box = boxRef.current!
    const c = canvasRef.current!
    const ctx = c.getContext('2d')!
    const n = faceOrigin(doc.res).size
    const view = { scale: 0, ox: 0, oy: 0 }
    const frameCanvas = document.createElement('canvas')
    const faceCanvas = document.createElement('canvas')
    frameCanvas.width = frameCanvas.height = faceCanvas.width = faceCanvas.height = n
    let hover: [number, number] | null = null
    let raf = 0

    const syncImages = () => {
      const img = doc.faces[state.current.frame]
      if (img) frameCanvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), n, n), 0, 0)
      const face = doc.faceImage()
      faceCanvas.getContext('2d')!.putImageData(new ImageData(face.data, n, n), 0, 0)
    }
    const draw = () => {
      raf = 0
      const dpr = window.devicePixelRatio
      const W = Math.round(box.clientWidth * dpr), H = Math.round(box.clientHeight * dpr)
      if (c.width !== W || c.height !== H) (c.width = W), (c.height = H), (view.scale = 0)
      if (!view.scale) {
        view.scale = (Math.min(W, H) * 0.92) / n
        view.ox = (W - n * view.scale) / 2
        view.oy = (H - n * view.scale) / 2
      }
      const { scale: s, ox, oy } = view
      const css = getComputedStyle(document.documentElement)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, W, H)
      // checkerboard so transparent pixels are visible
      const cell = Math.max(6, s)
      ctx.fillStyle = css.getPropertyValue('--checker-a')
      ctx.fillRect(ox, oy, n * s, n * s)
      ctx.fillStyle = css.getPropertyValue('--checker-b')
      for (let y = 0, j = 0; y < n * s; y += cell, j++) for (let x = (j % 2) * cell; x < n * s; x += cell * 2) ctx.fillRect(ox + x, oy + y, Math.min(cell, n * s - x), Math.min(cell, n * s - y))
      ctx.imageSmoothingEnabled = false
      ctx.globalAlpha = state.current.underlay
      ctx.drawImage(faceCanvas, ox, oy, n * s, n * s)
      ctx.globalAlpha = 1
      ctx.drawImage(frameCanvas, ox, oy, n * s, n * s)
      if (s >= 6) {
        ctx.strokeStyle = 'rgba(0,0,0,.15)'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let i = 0; i <= n; i++) {
          const p = Math.round(ox + i * s) + 0.5, q = Math.round(oy + i * s) + 0.5
          ctx.moveTo(p, oy), ctx.lineTo(p, oy + n * s)
          ctx.moveTo(ox, q), ctx.lineTo(ox + n * s, q)
        }
        ctx.stroke()
      }
      const e = useEditor.getState()
      if (e.mirror) {
        ctx.strokeStyle = css.getPropertyValue('--accent')
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.moveTo(ox + (n * s) / 2, oy)
        ctx.lineTo(ox + (n * s) / 2, oy + n * s)
        ctx.stroke()
        ctx.setLineDash([])
      }
      if (hover) {
        const size = e.tool === 'eraser' ? e.eraser.size : e.tool === 'brush' ? e.brush.size : 1
        const o = -Math.floor(size / 2)
        ctx.strokeStyle = css.getPropertyValue('--accent')
        ctx.lineWidth = 1.5
        ctx.strokeRect(ox + (hover[0] + o) * s, oy + (hover[1] + o) * s, size * s, size * s)
      }
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw)
    }
    syncImages()
    schedule()
    redraw.current = schedule
    const unsubDoc = doc.on((e) => {
      if (e.type === 'face' || e.type === 'structure' || e.type === 'pixels') syncImages()
      schedule()
    })
    const unsubStore = useEditor.subscribe(schedule)
    const ro = new ResizeObserver(schedule)
    ro.observe(box)

    const session = new PaintSession(doc)
    let pan: [number, number] | null = null
    const texel = (ev: { clientX: number; clientY: number }): [number, number] => {
      const r = c.getBoundingClientRect()
      const dpr = window.devicePixelRatio
      return [Math.floor(((ev.clientX - r.left) * dpr - view.ox) / view.scale), Math.floor(((ev.clientY - r.top) * dpr - view.oy) / view.scale)]
    }
    const inside = ([x, y]: [number, number]) => x >= 0 && y >= 0 && x < n && y < n
    const down = (ev: PointerEvent) => {
      try {
        c.setPointerCapture(ev.pointerId)
      } catch {
        // synthetic events have no active pointer
      }
      if (ev.button !== 0) {
        pan = [ev.clientX, ev.clientY]
        return
      }
      const p = texel(ev)
      if (inside(p)) session.down(p[0], p[1], null, null, true)
    }
    const move = (ev: PointerEvent) => {
      if (pan) {
        const dpr = window.devicePixelRatio
        view.ox += (ev.clientX - pan[0]) * dpr
        view.oy += (ev.clientY - pan[1]) * dpr
        pan = [ev.clientX, ev.clientY]
        return schedule()
      }
      const p = texel(ev)
      hover = inside(p) ? p : null
      if (session.active && hover) session.move(p[0], p[1], null)
      schedule()
    }
    const up = () => {
      pan = null
      session.up()
    }
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const r = c.getBoundingClientRect()
      const dpr = window.devicePixelRatio
      const mx = (ev.clientX - r.left) * dpr, my = (ev.clientY - r.top) * dpr
      const ns = Math.min(400, Math.max(2, view.scale * Math.exp(-ev.deltaY * 0.0015)))
      view.ox = mx - ((mx - view.ox) * ns) / view.scale
      view.oy = my - ((my - view.oy) * ns) / view.scale
      view.scale = ns
      schedule()
    }
    const noMenu = (ev: Event) => ev.preventDefault()
    c.addEventListener('pointerdown', down)
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
    c.addEventListener('pointerleave', () => ((hover = null), schedule()))
    c.addEventListener('wheel', wheel, { passive: false })
    c.addEventListener('contextmenu', noMenu)
    return () => {
      cancelAnimationFrame(raf)
      unsubDoc()
      unsubStore()
      ro.disconnect()
    }
  }, [doc, frame])

  useEffect(() => {
    redraw.current() // the underlay strength changed
  }, [underlay])

  return (
    // "painter-open" lets the editor's drawing shortcuts (B/E/I, [ ], M, Alt, Ctrl+Z/Y) work here
    <div className="modal-back painter-open">
      <div className="wardrobe painter">
        <header className="wardrobe-head">
          <Icon name="brush" size={18} />
          <b>{t('figura.frame')}:</b>
          <select className="select" value={frame} onChange={(e) => setFrame(e.target.value as FaceFrame)}>
            {frames.map((f) => (
              <option key={f} value={f}>{frameLabel(t, doc.figura, f)}</option>
            ))}
          </select>
          <div className="grow" />
          <button className="icon-btn" title={t('top.undo')} onClick={() => doc.undo()}><Icon name="undo" /></button>
          <button className="icon-btn" title={t('top.redo')} onClick={() => doc.redo()}><Icon name="redo" /></button>
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="toolbar">
          {TOOLS.map(([id, icon]) => (
            <button key={id} className={'icon-btn' + (ed.tool === id ? ' active' : '')} title={t(`tools.${id}`)} onClick={() => ed.set({ tool: id })}><Icon name={icon} size={17} /></button>
          ))}
          <label className="swatch-big checker" title={t('color.title')} style={{ width: 30, height: 30 }}>
            <div style={{ background: toHex(ed.color, false) }} />
            <input type="color" value={toHex(ed.color, false)} onChange={(e) => ed.set({ color: parseHex(e.target.value) ?? ed.color })} style={{ opacity: 0, width: '100%', height: '100%', border: 0, padding: 0 }} />
          </label>
          {ed.tool === 'gradient' && (
            <label className="swatch-big checker" title={t('tools.gradColors')} style={{ width: 30, height: 30 }}>
              <div style={{ background: toHex(ed.color2, false) }} />
              <input type="color" value={toHex(ed.color2, false)} onChange={(e) => ed.set({ color2: parseHex(e.target.value) ?? ed.color2 })} style={{ opacity: 0, width: '100%', height: '100%', border: 0, padding: 0 }} />
            </label>
          )}
          {(ed.tool === 'brush' || ed.tool === 'eraser') && (
            <label className="slider">
              <span className="muted">{t('tools.smooth')}</span>
              <input type="range" min={0} max={1} step={0.05} value={b.smooth ?? 0} onChange={(e) => ed.setBrush({ smooth: Number(e.target.value) })} />
              <span className="val">{Math.round((b.smooth ?? 0) * 100)}%</span>
            </label>
          )}
          <label className="slider">
            <span className="muted">{t('tools.size')}</span>
            <input type="range" min={1} max={Math.max(8, doc.res / 16)} value={b.size} onChange={(e) => ed.setBrush({ size: Number(e.target.value) })} />
            <span className="val">{b.size}</span>
          </label>
          <label className="slider">
            <span className="muted">{t('tools.opacity')}</span>
            <input type="range" min={0.05} max={1} step={0.05} value={b.opacity} onChange={(e) => ed.setBrush({ opacity: Number(e.target.value) })} />
            <span className="val">{Math.round(b.opacity * 100)}%</span>
          </label>
          <button className={'icon-btn' + (ed.mirror ? ' active' : '')} title={t('tools.mirror')} onClick={() => ed.set({ mirror: !ed.mirror })}><Icon name="mirror" size={17} /></button>
          <div className="grow" />
          <label className="slider">
            <span className="muted">{t('figura.underlay')}</span>
            <input type="range" min={0} max={1} step={0.05} value={underlay} onChange={(e) => setUnderlay(Number(e.target.value))} />
          </label>
        </div>
        <div className="painter-canvas checker-bg" ref={boxRef}>
          <canvas ref={canvasRef} />
        </div>
        <footer className="wardrobe-foot">
          <span className="muted" style={{ fontSize: 12 }}>{t('figura.painterHint')}</span>
          <div className="grow" />
          <button className="btn primary" onClick={onClose}>{t('common.close')}</button>
        </footer>
      </div>
    </div>
  )
}

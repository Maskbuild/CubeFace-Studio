import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { allFrames, hasAny, type FaceFrame, type MaskKey } from '../../skin/figura'
import { frameLabel } from './frameLabel'
import type { Rect } from '../../skin/layout'
import type { Stroke } from '../../skin/pixels'
import { useEditor } from '../../store/editor'
import { confirmBox, Modal, promptBox } from '../common/dialogs'
import { Icon } from '../common/Icon'

type Key = 'eyeR' | 'eyeL' | 'browR' | 'browL' | 'mouth'
const KEYS: Key[] = ['eyeR', 'eyeL', 'browR', 'browL', 'mouth']
const COLORS: Record<Key, string> = { eyeR: '#3fa9f5', eyeL: '#7c5cff', browR: '#ff9f1c', browL: '#e2c400', mouth: '#ff6b8a' }
const hasMask = (k: Key): k is MaskKey => k !== 'mouth'
type Tool = 'box' | 'add' | 'erase'

/**
 * Head-front editor: drag boxes for eyes, brows and mouth, and refine the iris / brow pixels
 * with a selection brush. Wheel zooms at the cursor, right/middle drag pans, double-click resets.
 */
function FaceEditor({ doc, big }: { doc: SkinDoc; big?: boolean }) {
  const { t } = useTranslation()
  const tick = useEditor((s) => s.tick)
  const ref = useRef<HTMLCanvasElement>(null)
  const view = useRef({ scale: 0, ox: 0, oy: 0 })
  const [, redraw] = useState(0)
  const [tool, setTool] = useState<Tool>('box')
  const [active, setActive] = useState<Key>('eyeR')
  const [size, setSize] = useState(1)
  const n = doc.res / 8
  const state = useRef({ tool, active, size })
  state.current = { tool, active, size }

  // mask strokes only emit 'mask' events; redraw on those too
  useEffect(() => doc.on((e) => e.type === 'mask' && redraw((k) => k + 1)), [doc])

  // draw
  useEffect(() => {
    const c = ref.current!
    const dpr = window.devicePixelRatio
    const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr)
    if (c.width !== W || c.height !== H) (c.width = W), (c.height = H)
    const v = view.current
    if (!v.scale) {
      v.scale = (Math.min(W, H) * 0.92) / n
      v.ox = (W - n * v.scale) / 2
      v.oy = (H - n * v.scale) / 2
    }
    const ctx = c.getContext('2d')!
    const face = doc.faceImage()
    const tmp = document.createElement('canvas')
    tmp.width = tmp.height = n
    tmp.getContext('2d')!.putImageData(new ImageData(face.data, n, n), 0, 0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, W, H)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(tmp, v.ox, v.oy, n * v.scale, n * v.scale)
    // selections, tinted with their feature colour
    for (const key of KEYS) {
      if (!hasMask(key)) continue
      const m = doc.masks[key]
      if (!m || !hasAny(m)) continue
      ctx.fillStyle = COLORS[key]
      ctx.globalAlpha = key === active ? 0.55 : 0.3
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) if (m.data[(y * n + x) * 4 + 3] > 127) ctx.fillRect(v.ox + x * v.scale, v.oy + y * v.scale, v.scale + 0.5, v.scale + 0.5)
      ctx.globalAlpha = 1
    }
    if (v.scale >= 6) {
      ctx.strokeStyle = 'rgba(0,0,0,.18)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i <= n; i++) {
        const p = Math.round(v.ox + i * v.scale) + 0.5, q = Math.round(v.oy + i * v.scale) + 0.5
        ctx.moveTo(p, v.oy), ctx.lineTo(p, v.oy + n * v.scale)
        ctx.moveTo(v.ox, q), ctx.lineTo(v.ox + n * v.scale, q)
      }
      ctx.stroke()
    }
    const hs = 8 * dpr
    for (const key of KEYS) {
      const r = doc.figura[key]
      ctx.strokeStyle = COLORS[key]
      ctx.lineWidth = (key === active ? 2.5 : 1.5) * dpr
      ctx.setLineDash(key === active ? [] : [4 * dpr, 3 * dpr])
      ctx.strokeRect(v.ox + r.x * v.scale, v.oy + r.y * v.scale, r.w * v.scale, r.h * v.scale)
      ctx.setLineDash([])
      if (tool === 'box') {
        ctx.fillStyle = COLORS[key]
        ctx.fillRect(v.ox + (r.x + r.w) * v.scale - hs, v.oy + (r.y + r.h) * v.scale - hs, hs, hs)
      }
    }
  })

  // input
  useEffect(() => {
    const c = ref.current!
    const dpr = () => window.devicePixelRatio
    let drag: { key: Key; mode: 'move' | 'size'; start: [number, number]; orig: Rect } | null = null
    let pan: [number, number] | null = null
    let stroke: Stroke | null = null
    let last: [number, number] | null = null
    const at = (e: { clientX: number; clientY: number }): [number, number] => {
      const r = c.getBoundingClientRect()
      return [(e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr()]
    }
    const tex = (p: [number, number]): [number, number] => [(p[0] - view.current.ox) / view.current.scale, (p[1] - view.current.oy) / view.current.scale]
    const brush = () => ({ size: state.current.size, softness: 0, shape: 'square' as const })
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId)
      if (e.button !== 0) {
        pan = at(e)
        return
      }
      const [x, y] = tex(at(e))
      const { tool, active } = state.current
      if (tool !== 'box' && hasMask(active)) {
        stroke = doc.beginMaskStroke(active, tool === 'add' ? 'paint' : 'erase')
        last = [Math.floor(x), Math.floor(y)]
        doc.stamp(stroke, last[0], last[1], brush(), null, false)
        return
      }
      const hs = (8 * dpr()) / view.current.scale + 0.25
      // the active feature is picked first so overlapping boxes stay editable
      for (const key of [state.current.active, ...[...KEYS].reverse()]) {
        const r = doc.figura[key]
        if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue
        const corner = x >= r.x + r.w - hs && y >= r.y + r.h - hs
        drag = { key, mode: corner ? 'size' : 'move', start: [x, y], orig: { ...r } }
        setActive(key)
        return
      }
    }
    const move = (e: PointerEvent) => {
      if (pan) {
        const p = at(e)
        view.current.ox += p[0] - pan[0]
        view.current.oy += p[1] - pan[1]
        pan = p
        return redraw((k) => k + 1)
      }
      if (stroke && last) {
        const [x, y] = tex(at(e)).map(Math.floor) as [number, number]
        if (x !== last[0] || y !== last[1]) doc.strokeLine(stroke, last, [x, y], brush(), null, false)
        last = [x, y]
        return
      }
      if (!drag) return
      const [x, y] = tex(at(e))
      const dx = Math.round(x - drag.start[0]), dy = Math.round(y - drag.start[1])
      const o = drag.orig
      const r =
        drag.mode === 'move'
          ? { ...o, x: Math.max(0, Math.min(n - o.w, o.x + dx)), y: Math.max(0, Math.min(n - o.h, o.y + dy)) }
          : { ...o, w: Math.max(1, Math.min(n - o.x, o.w + dx)), h: Math.max(1, Math.min(n - o.y, o.h + dy)) }
      const cur = doc.figura[drag.key]
      if (r.x !== cur.x || r.y !== cur.y || r.w !== cur.w || r.h !== cur.h) doc.updateFigura({ [drag.key]: r })
    }
    const up = () => {
      if (stroke) doc.endStroke(stroke)
      stroke = null
      last = null
      drag = null
      pan = null
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const [mx, my] = at(e)
      const v = view.current
      const ns = Math.min(400, Math.max(2, v.scale * Math.exp(-e.deltaY * 0.0015)))
      v.ox = mx - ((mx - v.ox) * ns) / v.scale
      v.oy = my - ((my - v.oy) * ns) / v.scale
      v.scale = ns
      redraw((k) => k + 1)
    }
    const reset = () => {
      view.current.scale = 0
      redraw((k) => k + 1)
    }
    const noMenu = (e: Event) => e.preventDefault()
    c.addEventListener('pointerdown', down)
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
    c.addEventListener('wheel', wheel, { passive: false })
    c.addEventListener('dblclick', reset)
    c.addEventListener('contextmenu', noMenu)
    return () => {
      c.removeEventListener('pointerdown', down)
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
      c.removeEventListener('wheel', wheel)
      c.removeEventListener('dblclick', reset)
      c.removeEventListener('contextmenu', noMenu)
    }
  }, [doc, n])

  useEffect(() => {
    view.current.scale = 0
    redraw((k) => k + 1)
  }, [n])

  const maskable = hasMask(active)
  return (
    <div className="face-editor">
      <div className="feature-pick">
        {KEYS.map((key) => (
          <button key={key} className={'feature-chip' + (active === key ? ' on' : '')} style={{ ['--c' as string]: COLORS[key] }} onClick={() => setActive(key)}>
            <span className="sw" />
            {t(`figura.${key}`)}
            {hasMask(key) && hasAny(doc.masks[key]) && <Icon name="check" size={11} stroke={3} />}
          </button>
        ))}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div className="seg">
          <button className={tool === 'box' ? 'on' : ''} onClick={() => setTool('box')} title={t('figura.toolBoxHint')}>{t('figura.toolBox')}</button>
          <button className={tool === 'add' ? 'on' : ''} disabled={!maskable} onClick={() => setTool('add')}>{t('figura.toolAdd')}</button>
          <button className={tool === 'erase' ? 'on' : ''} disabled={!maskable} onClick={() => setTool('erase')}>{t('figura.toolErase')}</button>
        </div>
        {tool !== 'box' && (
          <label className="row muted" style={{ fontSize: 12 }}>
            {t('tools.size')}
            <input type="range" min={1} max={Math.max(4, n / 8)} value={size} onChange={(e) => setSize(Number(e.target.value))} style={{ width: 70 }} />
            {size}
          </label>
        )}
        <button className="btn sm-btn" disabled={!maskable} title={t('figura.autoHint')} onClick={() => hasMask(active) && doc.autoMask(active)}>
          <Icon name="sparkle" size={12} />
          {t('figura.autoSelect')}
        </button>
        <button className="btn sm-btn" disabled={!maskable || !hasMask(active) || !doc.masks[active]} onClick={() => hasMask(active) && doc.clearMask(active)}>
          <Icon name="x" size={12} />
          {t('figura.clearSelect')}
        </button>
      </div>
      <canvas ref={ref} data-tick={tick} className={'face-rects checker' + (big ? ' big' : '') + (tool !== 'box' ? ' brush' : '')} />
      <span className="muted" style={{ fontSize: 11 }}>{maskable ? t(active.startsWith('eye') ? 'figura.maskEyeHelp' : 'figura.maskBrowHelp') : t('figura.mouthHelp')}</span>
    </div>
  )
}

export function FacePanel({ doc }: { doc: SkinDoc }) {
  const { t } = useTranslation()
  useEditor((s) => s.tick)
  const [big, setBig] = useState(false)
  const has = (f: FaceFrame) => !!doc.faces[f]
  const frames = allFrames(doc.figura)
  const any = frames.some(has)
  const custom = (f: FaceFrame) => doc.figura.customExpr.find((c) => 'x_' + c.id === f)
  const addCustom = async () => {
    const name = (await promptBox(t('figura.customName'), '', t('common.create'), t('common.cancel')))?.trim()
    if (name) doc.addCustomExpr(name)
  }

  const generateAll = async () => {
    if (any && !(await confirmBox(t('figura.overwrite'), t('common.ok'), t('common.cancel')))) return
    doc.generateFaces()
  }

  return (
    <div className="face-panel">
      <div className="section">
        <div className="section-head">
          <span className="label">{t('figura.face')}</span>
          <button className="btn sm-btn" onClick={() => setBig(true)}><Icon name="zoom" size={13} />{t('figura.enlarge')}</button>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>{t('figura.faceHelp')}</span>
        {!big && <FaceEditor doc={doc} />}
        <button className="btn primary" onClick={generateAll}><Icon name="sparkle" />{t('figura.generate')}</button>
      </div>
      <div className="section" style={{ borderBottom: 0 }}>
        <span className="muted" style={{ fontSize: 12 }}>{t('figura.paintHint')}</span>
        <div className="hair-list">
          {frames.map((f) =>
            custom(f) ? (
              <div key={f} className={'layer' + (doc.faceFrame === f ? ' on' : '')} onClick={() => doc.selectFace(doc.faceFrame === f ? null : f)}>
                <Icon name="brush" size={13} />
                <span className="lname">{frameLabel(t, doc.figura, f)}</span>
                <label className="row muted" style={{ fontSize: 11, gap: 3 }} title={t('figura.coversEyesHint')} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={custom(f)!.coversEyes} onChange={(e) => doc.updateCustomExpr(custom(f)!.id, { coversEyes: e.target.checked })} />
                  {t('figura.coversEyes')}
                </label>
                <button
                  className="icon-btn sm"
                  title={t('common.rename')}
                  onClick={async (e) => {
                    e.stopPropagation()
                    const name = (await promptBox(t('figura.customName'), custom(f)!.name, t('common.ok'), t('common.cancel')))?.trim()
                    if (name) doc.updateCustomExpr(custom(f)!.id, { name })
                  }}
                >
                  <Icon name="edit" size={13} />
                </button>
                <button className="icon-btn sm" title={t('figura.clearFrame')} onClick={(e) => (e.stopPropagation(), doc.clearFace(f))}><Icon name="eraser" size={13} /></button>
                <button className="icon-btn sm" title={t('common.delete')} onClick={(e) => (e.stopPropagation(), doc.removeCustomExpr(custom(f)!.id))}><Icon name="trash" size={13} /></button>
              </div>
            ) : has(f) ? (
              <div key={f} className={'layer' + (doc.faceFrame === f ? ' on' : '')} onClick={() => doc.selectFace(doc.faceFrame === f ? null : f)}>
                <Icon name="brush" size={13} />
                <span className="lname">{frameLabel(t, doc.figura, f)}</span>
                <button className="icon-btn sm" title={t('figura.regenerate')} onClick={(e) => (e.stopPropagation(), doc.generateFaces([f]))}><Icon name="sparkle" size={13} /></button>
                <button className="icon-btn sm" title={t('figura.clearFrame')} onClick={(e) => (e.stopPropagation(), doc.clearFace(f))}><Icon name="eraser" size={13} /></button>
                <button className="icon-btn sm" title={t('common.delete')} onClick={(e) => (e.stopPropagation(), doc.removeFace(f))}><Icon name="trash" size={13} /></button>
              </div>
            ) : (
              <div key={f} className="layer missing-frame">
                <span className="lname muted">{frameLabel(t, doc.figura, f)}</span>
                <button className="btn sm-btn" title={t('figura.drawOwnHint')} onClick={() => doc.createBlankFace(f)}><Icon name="brush" size={12} />{t('figura.drawOwn')}</button>
                <button className="btn sm-btn" onClick={() => doc.generateFaces([f])}><Icon name="sparkle" size={12} />{t('figura.auto')}</button>
              </div>
            )
          )}
        </div>
        <button className="btn" onClick={addCustom}><Icon name="plus" />{t('figura.addCustom')}</button>
      </div>
      {big && (
        <Modal title={t('figura.face')} onClose={() => setBig(false)} footer={<button className="btn primary" onClick={() => setBig(false)}>{t('common.close')}</button>}>
          <span className="muted" style={{ fontSize: 12 }}>{t('figura.faceHelp')} {t('figura.zoomHelp')}</span>
          <FaceEditor doc={doc} big />
        </Modal>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { allFrames, FACE_RESOLUTIONS, type FaceFrame } from '../../skin/figura'
import type { Rect } from '../../skin/layout'
import { useEditor } from '../../store/editor'
import { confirmBox, Modal, promptBox } from '../common/dialogs'
import { Icon } from '../common/Icon'
import { ContextMenu, type MenuItem } from '../common/ContextMenu'
import { frameLabel } from './frameLabel'
import { FacePainter } from './FacePainter'
import { FaceSetWindow } from './FaceSetWindow'

type Key = 'eyeR' | 'eyeL' | 'mouth'
const KEYS: Key[] = ['eyeR', 'eyeL', 'mouth']
const COLORS: Record<Key, string> = { eyeR: '#3fa9f5', eyeL: '#7c5cff', mouth: '#ff6b8a' }

/**
 * Head-front view where the eye and mouth boxes are dragged into place (corner square resizes).
 * Wheel zooms at the cursor, right/middle drag pans, double-click resets the view.
 */
function FaceBoxes({ doc, big }: { doc: SkinDoc; big?: boolean }) {
  const tick = useEditor((s) => s.tick)
  const ref = useRef<HTMLCanvasElement>(null)
  const view = useRef({ scale: 0, ox: 0, oy: 0 })
  const [, redraw] = useState(0)
  const n = doc.faceSize()

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
      ctx.lineWidth = 2 * dpr
      ctx.strokeRect(v.ox + r.x * v.scale, v.oy + r.y * v.scale, r.w * v.scale, r.h * v.scale)
      ctx.fillStyle = COLORS[key]
      ctx.fillRect(v.ox + (r.x + r.w) * v.scale - hs, v.oy + (r.y + r.h) * v.scale - hs, hs, hs)
    }
  })

  useEffect(() => {
    const c = ref.current!
    const dpr = () => window.devicePixelRatio
    let drag: { key: Key; mode: 'move' | 'size'; start: [number, number]; orig: Rect } | null = null
    let pan: [number, number] | null = null
    const at = (e: { clientX: number; clientY: number }): [number, number] => {
      const r = c.getBoundingClientRect()
      return [(e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr()]
    }
    const tex = (p: [number, number]): [number, number] => [(p[0] - view.current.ox) / view.current.scale, (p[1] - view.current.oy) / view.current.scale]
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId)
      if (e.button !== 0) {
        pan = at(e)
        return
      }
      const [x, y] = tex(at(e))
      const hs = (8 * dpr()) / view.current.scale + 0.25
      for (const key of [...KEYS].reverse()) {
        const r = doc.figura[key]
        if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue
        const corner = x >= r.x + r.w - hs && y >= r.y + r.h - hs
        drag = { key, mode: corner ? 'size' : 'move', start: [x, y], orig: { ...r } }
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
    const up = () => ((drag = null), (pan = null))
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

  return <canvas ref={ref} data-tick={tick} className={'face-rects checker' + (big ? ' big' : '')} />
}

function Legend() {
  const { t } = useTranslation()
  return (
    <div className="row" style={{ gap: 10, fontSize: 12, flexWrap: 'wrap' }}>
      {KEYS.map((key) => (
        <span key={key} className="row" style={{ gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: COLORS[key] }} />
          {t(`figura.${key}`)}
        </span>
      ))}
    </div>
  )
}

export function FacePanel({ doc }: { doc: SkinDoc }) {
  const { t } = useTranslation()
  useEditor((s) => s.tick)
  const [big, setBig] = useState(false)
  const [painting, setPainting] = useState<FaceFrame | null>(null)
  const [sets, setSets] = useState(false)
  const has = (f: FaceFrame) => !!doc.faces[f]
  const frames = allFrames(doc.figura)
  const any = frames.some(has)
  const custom = (f: FaceFrame) => doc.figura.customExpr.find((c) => 'x_' + c.id === f)

  const generateAll = async () => {
    if (any && !(await confirmBox(t('figura.overwrite'), t('common.ok'), t('common.cancel')))) return
    doc.generateFaces()
  }
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const open = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }
  /** Everything you can do with a drawn frame, in one menu instead of a row of buttons. */
  const frameMenu = (e: React.MouseEvent, f: FaceFrame) => {
    const c = custom(f)
    open(e, [
      { label: t('figura.paintWindow'), icon: 'edit', onClick: () => setPainting(f) },
      ...(!c ? [{ label: f === 'base' ? t('figura.restartFromFace') : t('figura.regenerate'), icon: 'sparkle', onClick: () => doc.generateFaces([f]) }] : []),
      ...(f !== 'base' ? [{ label: t('figura.restartFromFace'), icon: 'copy', onClick: () => doc.createBlankFace(f, true) }] : []),
      ...(c
        ? [
            {
              label: t('common.rename'),
              icon: 'edit',
              onClick: async () => {
                const name = (await promptBox(t('figura.customName'), c.name, t('common.ok'), t('common.cancel')))?.trim()
                if (name) doc.updateCustomExpr(c.id, { name })
              }
            },
            { label: t('figura.coversEyes'), icon: c.coversEyes ? 'check' : undefined, onClick: () => doc.updateCustomExpr(c.id, { coversEyes: !c.coversEyes }) }
          ]
        : []),
      'sep',
      { label: t('figura.clearFrame'), icon: 'eraser', onClick: () => doc.clearFace(f) },
      { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => (c ? doc.removeCustomExpr(c.id) : doc.removeFace(f)) }
    ])
  }
  /** Ways to start a frame that isn't drawn yet. */
  const newMenu = (e: React.MouseEvent, f: FaceFrame) =>
    open(e, [
      ...(f !== 'base' ? [{ label: t('figura.drawOwn'), icon: 'brush', onClick: () => doc.createBlankFace(f) }] : []),
      { label: t('figura.fromFace'), icon: 'copy', onClick: () => doc.createBlankFace(f, true) },
      ...(!custom(f) && f !== 'base' ? [{ label: t('figura.auto'), icon: 'sparkle', onClick: () => doc.generateFaces([f]) }] : [])
    ])
  const addCustom = async () => {
    const name = (await promptBox(t('figura.customName'), '', t('common.create'), t('common.cancel')))?.trim()
    if (name) doc.addCustomExpr(name)
  }

  return (
    <div className="face-panel">
      <div className="section">
        <div className="section-head">
          <span className="label">{t('figura.face')}</span>
          <button className="btn sm-btn" onClick={() => setBig(true)}><Icon name="zoom" size={13} />{t('figura.enlarge')}</button>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>{t('figura.faceHelp')}</span>
        <label className="row" style={{ fontSize: 12, gap: 6 }} title={t('figura.faceResHint')}>
          <span className="muted">{t('figura.faceRes')}</span>
          <select className="input sm" value={doc.figura.faceRes ?? ''} onChange={(e) => doc.setFaceRes(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">{t('figura.faceResSkin', { r: doc.res, n: doc.res / 8 })}</option>
            {FACE_RESOLUTIONS.map((r) => <option key={r} value={r}>{t('figura.faceResOpt', { r, n: r / 8 })}</option>)}
          </select>
        </label>
        {!big && <FaceBoxes doc={doc} />}
        <Legend />
        <div className="row" style={{ gap: 6 }}>
          <button className="btn primary grow" onClick={generateAll}><Icon name="sparkle" />{t('figura.generate')}</button>
          <button className="btn" onClick={() => setSets(true)} title={t('faceSets.hint')}><Icon name="smile" />{t('faceSets.open')}</button>
        </div>
        <label className="row" style={{ fontSize: 12 }} title={t('glow.eyesHint')}>
          <input type="checkbox" checked={!!doc.figura.glowEyes} onChange={(e) => doc.updateFigura({ glowEyes: e.target.checked })} />
          <Icon name="sun" size={13} />
          {t('glow.eyes')}
        </label>
        {doc.figura.glowEyes && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm-btn grow" title={t('glow.spotsHint')} onClick={() => setPainting(doc.ensureGlowMask())}>
              <Icon name="brush" size={13} />
              {t('glow.spots')}
            </button>
            {doc.faces.glowMask && (
              <button className="btn sm-btn" title={t('glow.spotsResetHint')} onClick={() => doc.removeFace('glowMask')}>{t('glow.spotsReset')}</button>
            )}
          </div>
        )}
      </div>
      <div className="section" style={{ borderBottom: 0 }}>
        <span className="muted" style={{ fontSize: 12 }}>{t('figura.paintHint')}</span>
        <div className="hair-list">
          {frames.map((f) =>
            has(f) ? (
              <div
                key={f}
                className={'layer frame-row' + (doc.faceFrame === f ? ' on' : '')}
                onClick={() => doc.selectFace(doc.faceFrame === f ? null : f)}
                onDoubleClick={() => setPainting(f)}
                onContextMenu={(e) => frameMenu(e, f)}
              >
                <Icon name="brush" size={13} />
                <span className="lname">{frameLabel(t, doc.figura, f)}</span>
                <button className="icon-btn sm" title={t('figura.paintWindow')} onClick={(e) => (e.stopPropagation(), setPainting(f))}><Icon name="edit" size={13} /></button>
                <button className="icon-btn sm" title={t('figura.more')} onClick={(e) => frameMenu(e, f)}><Icon name="more" size={13} /></button>
              </div>
            ) : (
              <div key={f} className="layer frame-row missing-frame" onClick={(e) => newMenu(e, f)}>
                <Icon name="plus" size={13} />
                <span className="lname muted">{frameLabel(t, doc.figura, f)}</span>
                <button className="icon-btn sm" title={t('figura.create')} onClick={(e) => newMenu(e, f)}><Icon name="more" size={13} /></button>
              </div>
            )
          )}
        </div>
        <button className="btn" onClick={addCustom}><Icon name="plus" />{t('figura.addCustom')}</button>
      </div>
      {painting && <FacePainter doc={doc} frame={painting} onClose={() => setPainting(null)} />}
      {sets && <FaceSetWindow doc={doc} onClose={() => setSets(false)} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {big && (
        <Modal title={t('figura.face')} onClose={() => setBig(false)} footer={<button className="btn primary" onClick={() => setBig(false)}>{t('common.close')}</button>}>
          <span className="muted" style={{ fontSize: 12 }}>{t('figura.faceHelp')} {t('figura.zoomHelp')}</span>
          <FaceBoxes doc={doc} big />
          <Legend />
        </Modal>
      )}
    </div>
  )
}

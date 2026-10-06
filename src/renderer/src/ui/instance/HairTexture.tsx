import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { hairTips, type HairPlane } from '../../skin/hair'
import { createImg, flipImg, shiftImg, type Img } from '../../skin/pixels'
import { dataUrlToImg, imgToCanvas } from '../../lib/png'
import { storage } from '../../lib/storage'
import { Icon } from '../common/Icon'
import { Modal } from '../common/dialogs'

type Box = { x: number; y: number; w: number; h: number } // in source pixels

/** Copy a region of `src` into a w×h image (nearest neighbour, keeps pixel art crisp). */
function cropTo(src: Img, box: Box, w: number, h: number): Img {
  const out = createImg(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.w - 1, Math.max(0, Math.floor(box.x + ((x + 0.5) * box.w) / w)))
      const sy = Math.min(src.h - 1, Math.max(0, Math.floor(box.y + ((y + 0.5) * box.h) / h)))
      out.data.set(src.data.subarray((sy * src.w + sx) * 4, (sy * src.w + sx) * 4 + 4), (y * w + x) * 4)
    }
  return out
}

/**
 * Put a picture on a hair plane: drag the UV box over the picture to choose the part that
 * goes on the plane (its shape follows the plane), resize it with the wheel or the corner.
 */
export function HairTextureDialog({ doc, h, onClose }: { doc: SkinDoc; h: HairPlane; onClose: () => void }) {
  const { t } = useTranslation()
  const [src, setSrc] = useState<Img | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const aspect = h.img.w / h.img.h
  const tw = h.img.w, th = h.img.h

  const pick = async () => {
    const f = await storage.openImage()
    if (!f) return
    const img = await dataUrlToImg(f.dataUrl)
    setSrc(img)
    // largest box with the plane's shape that fits the picture
    const w = Math.min(img.w, img.h * aspect)
    setBox({ x: (img.w - w) / 2, y: 0, w, h: w / aspect })
  }
  useEffect(() => void pick(), [])

  // draw the picture with the box on top
  const VIEW = 360
  const scale = src ? Math.min(VIEW / src.w, VIEW / src.h) : 1
  useEffect(() => {
    const c = canvas.current
    if (!c || !src || !box) return
    c.width = Math.round(src.w * scale)
    c.height = Math.round(src.h * scale)
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    g.clearRect(0, 0, c.width, c.height)
    g.drawImage(imgToCanvas(src), 0, 0, c.width, c.height)
    g.fillStyle = 'rgba(0,0,0,0.45)'
    g.fillRect(0, 0, c.width, c.height)
    g.drawImage(imgToCanvas(src), box.x, box.y, box.w, box.h, box.x * scale, box.y * scale, box.w * scale, box.h * scale)
    g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3fd6e3'
    g.lineWidth = 2
    g.strokeRect(box.x * scale, box.y * scale, box.w * scale, box.h * scale)
    g.fillStyle = g.strokeStyle
    g.fillRect((box.x + box.w) * scale - 6, (box.y + box.h) * scale - 6, 10, 10)
  }, [src, box, scale])

  const clamp = (b: Box): Box => {
    if (!src) return b
    const w = Math.max(2, Math.min(b.w, src.w, src.h * aspect))
    const hh = w / aspect
    return { w, h: hh, x: Math.min(Math.max(0, b.x), src.w - w), y: Math.min(Math.max(0, b.y), src.h - hh) }
  }
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!box) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left) / scale, py = (e.clientY - r.top) / scale
    const corner = Math.abs(px - (box.x + box.w)) < 10 / scale && Math.abs(py - (box.y + box.h)) < 10 / scale
    const start = { px, py, box }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const move = (ev: PointerEvent) => {
      const qx = (ev.clientX - r.left) / scale, qy = (ev.clientY - r.top) / scale
      if (corner) setBox(clamp({ ...start.box, w: Math.max(qx - start.box.x, (qy - start.box.y) * aspect) }))
      else setBox(clamp({ ...start.box, x: start.box.x + qx - start.px, y: start.box.y + qy - start.py }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onWheel = (e: React.WheelEvent) => {
    if (!box) return
    const k = e.deltaY > 0 ? 1.1 : 1 / 1.1
    const w = box.w * k
    setBox(clamp({ x: box.x + (box.w - w) / 2, y: box.y + (box.h - w / aspect) / 2, w, h: w / aspect }))
  }

  const result = src && box ? cropTo(src, box, tw, th) : null
  const previewUrl = result ? imgToCanvas(result).toDataURL() : null

  return (
    <Modal
      title={t('hair.textureTitle', { name: h.name })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={pick}><Icon name="image" />{t('hair.textureOther')}</button>
          <div className="grow" />
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={!result} onClick={() => (result && doc.setHairPixels(h.id, result), onClose())}>{t('hair.textureApply')}</button>
        </>
      }
    >
      <div className="hair-tex">
        <div className="hair-tex-src checker-bg" onWheel={onWheel}>
          {src ? <canvas ref={canvas} onPointerDown={onDown} /> : <span className="muted">{t('hair.texturePick')}</span>}
        </div>
        <div className="hair-tex-side">
          <span className="label">{t('hair.texturePreview')}</span>
          {previewUrl && <img className="pix checker-bg" src={previewUrl} alt="" style={{ width: 96, height: 96 / aspect, maxHeight: 220, objectFit: 'contain' }} />}
          <span className="muted" style={{ fontSize: 11 }}>{t('hair.textureHint', { w: tw, h: th })}</span>
        </div>
      </div>
    </Modal>
  )
}

/** Small tools under a hair plane: import a picture, move the texture (UV) and flip it. */
export function HairTextureTools({ doc, h }: { doc: SkinDoc; h: HairPlane }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const k = h.img.w / Math.max(1, h.w) // texels per skin pixel
  const [tipLen, setTipLen] = useState(Math.max(2, Math.round(h.img.h * 0.25)))
  const [tipW, setTipW] = useState(Math.max(2, Math.round(k * 2)))
  const [seed, setSeed] = useState(1)
  const shift = (dx: number, dy: number) => doc.setHairPixels(h.id, shiftImg(h.img, dx, dy))
  return (
    <div className="hair-tex-tools">
      <button className="btn sm-btn" onClick={() => setOpen(true)}><Icon name="image" size={13} />{t('hair.textureImport')}</button>
      <span className="muted" style={{ fontSize: 11 }}>{t('hair.textureMove')}</span>
      <div className="row" style={{ gap: 2 }}>
        <button className="icon-btn sm" title="←" onClick={() => shift(-1, 0)}>←</button>
        <button className="icon-btn sm" title="→" onClick={() => shift(1, 0)}>→</button>
        <button className="icon-btn sm" title="↑" onClick={() => shift(0, -1)}>↑</button>
        <button className="icon-btn sm" title="↓" onClick={() => shift(0, 1)}>↓</button>
        <button className="icon-btn sm" title={t('hair.flipX')} onClick={() => doc.setHairPixels(h.id, flipImg(h.img, 'x'))}>⇋</button>
        <button className="icon-btn sm" title={t('hair.flipY')} onClick={() => doc.setHairPixels(h.id, flipImg(h.img, 'y'))}>⇵</button>
      </div>
      <span className="muted" style={{ fontSize: 11 }}>{t('hair.tips')}</span>
      <label className="phys-row">
        <span className="muted">{t('hair.tipLength')}</span>
        <input type="range" min={1} max={Math.max(2, h.img.h)} value={tipLen} onChange={(e) => setTipLen(Number(e.target.value))} />
        <span className="val">{tipLen}</span>
      </label>
      <label className="phys-row">
        <span className="muted">{t('hair.tipWidth')}</span>
        <input type="range" min={2} max={Math.max(3, h.img.w)} value={tipW} onChange={(e) => setTipW(Number(e.target.value))} />
        <span className="val">{tipW}</span>
      </label>
      <button
        className="btn sm-btn"
        title={t('hair.tipsHint')}
        onClick={() => {
          doc.setHairPixels(h.id, hairTips(h.img, tipW, tipLen, seed))
          setSeed(seed + 1) // another click gives other tip lengths
        }}
      >
        <Icon name="sparkle" size={12} />
        {t('hair.makeTips')}
      </button>
      {open && <HairTextureDialog doc={doc} h={h} onClose={() => setOpen(false)} />}
    </div>
  )
}

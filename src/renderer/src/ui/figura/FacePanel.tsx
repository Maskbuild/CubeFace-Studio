import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { FACE_FRAMES, type FaceFrame } from '../../skin/figura'
import type { Rect } from '../../skin/layout'
import { useEditor } from '../../store/editor'
import { confirmBox } from '../common/dialogs'
import { Icon } from '../common/Icon'

type Key = 'eyeR' | 'eyeL' | 'mouth'
const KEYS: Key[] = ['eyeR', 'eyeL', 'mouth']
const COLORS: Record<Key, string> = { eyeR: '#3fa9f5', eyeL: '#7c5cff', mouth: '#ff6b8a' }

/** Head-front preview where the eye and mouth boxes are dragged into place. */
function FaceRects({ doc }: { doc: SkinDoc }) {
  const { t } = useTranslation()
  useEditor((s) => s.tick)
  const ref = useRef<HTMLCanvasElement>(null)
  const n = doc.res / 8
  const SIZE = 240

  useEffect(() => {
    const c = ref.current!
    c.width = c.height = SIZE
    const ctx = c.getContext('2d')!
    const face = doc.faceImage()
    const tmp = document.createElement('canvas')
    tmp.width = tmp.height = n
    tmp.getContext('2d')!.putImageData(new ImageData(face.data, n, n), 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, SIZE, SIZE)
    ctx.drawImage(tmp, 0, 0, SIZE, SIZE)
    const k = SIZE / n
    for (const key of KEYS) {
      const r = doc.figura[key]
      ctx.strokeStyle = COLORS[key]
      ctx.lineWidth = 2
      ctx.strokeRect(r.x * k + 1, r.y * k + 1, r.w * k - 2, r.h * k - 2)
      ctx.fillStyle = COLORS[key]
      ctx.fillRect((r.x + r.w) * k - 7, (r.y + r.h) * k - 7, 7, 7) // resize handle
    }
  })

  useEffect(() => {
    const c = ref.current!
    const k = SIZE / n
    let drag: { key: Key; mode: 'move' | 'size'; start: [number, number]; orig: Rect } | null = null
    const at = (e: PointerEvent): [number, number] => {
      const r = c.getBoundingClientRect()
      return [((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE]
    }
    const down = (e: PointerEvent) => {
      const [x, y] = at(e)
      // last drawn wins (mouth over eyes); corner handle resizes
      for (const key of [...KEYS].reverse()) {
        const r = doc.figura[key]
        const inside = x >= r.x * k && x <= (r.x + r.w) * k && y >= r.y * k && y <= (r.y + r.h) * k
        if (!inside) continue
        const corner = x >= (r.x + r.w) * k - 9 && y >= (r.y + r.h) * k - 9
        drag = { key, mode: corner ? 'size' : 'move', start: [x, y], orig: { ...r } }
        c.setPointerCapture(e.pointerId)
        return
      }
    }
    const move = (e: PointerEvent) => {
      if (!drag) return
      const [x, y] = at(e)
      const dx = Math.round((x - drag.start[0]) / k), dy = Math.round((y - drag.start[1]) / k)
      const o = drag.orig
      const r =
        drag.mode === 'move'
          ? { ...o, x: Math.max(0, Math.min(n - o.w, o.x + dx)), y: Math.max(0, Math.min(n - o.h, o.y + dy)) }
          : { ...o, w: Math.max(1, Math.min(n - o.x, o.w + dx)), h: Math.max(1, Math.min(n - o.y, o.h + dy)) }
      const cur = doc.figura[drag.key]
      if (r.x !== cur.x || r.y !== cur.y || r.w !== cur.w || r.h !== cur.h) doc.updateFigura({ [drag.key]: r })
    }
    const up = () => (drag = null)
    c.addEventListener('pointerdown', down)
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
    return () => {
      c.removeEventListener('pointerdown', down)
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
    }
  }, [doc, n])

  return (
    <>
      <canvas ref={ref} className="face-rects checker" />
      <div className="row" style={{ gap: 10, fontSize: 12, flexWrap: 'wrap' }}>
        {KEYS.map((key) => (
          <span key={key} className="row" style={{ gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: COLORS[key] }} />
            {t(`figura.${key}`)}
          </span>
        ))}
      </div>
    </>
  )
}

export function FacePanel({ doc }: { doc: SkinDoc }) {
  const { t } = useTranslation()
  useEditor((s) => s.tick)
  const has = (f: FaceFrame) => !!doc.faces[f]
  const any = FACE_FRAMES.some(has)

  const generate = async () => {
    if (any && !(await confirmBox(t('figura.overwrite'), t('common.ok'), t('common.cancel')))) return
    doc.generateFaces()
  }

  return (
    <div className="face-panel">
      <div className="section">
        <span className="label">{t('figura.face')}</span>
        <span className="muted" style={{ fontSize: 12 }}>{t('figura.faceHelp')}</span>
        <FaceRects doc={doc} />
        <button className="btn primary" onClick={generate}><Icon name="sparkle" />{t('figura.generate')}</button>
      </div>
      <div className="section" style={{ borderBottom: 0 }}>
        <span className="muted" style={{ fontSize: 12 }}>{any ? t('figura.paintHint') : t('figura.noFrames')}</span>
        <div className="hair-list">
          {FACE_FRAMES.filter(has).map((f) => (
            <div key={f} className={'layer' + (doc.faceFrame === f ? ' on' : '')} onClick={() => doc.selectFace(doc.faceFrame === f ? null : f)}>
              <span className="lname">{t(`figura.frames.${f}`)}</span>
              <button className="icon-btn sm" title={t('figura.regenerate')} onClick={(e) => (e.stopPropagation(), doc.generateFaces([f]))}>
                <Icon name="reset" size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

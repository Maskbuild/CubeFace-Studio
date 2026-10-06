import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { allFrames, ICON_SIZES, type FaceFrame, type IconSize, type WheelIcon } from '../../skin/figura'
import { faceWithFrame } from '../../figura/avatar'
import { imgToDataUrl, loadImage } from '../../lib/png'
import { storage } from '../../lib/storage'
import { downloadPack, useItemIcon, usePack, type PackState } from '../../mc/library'
import type { McPack, McVersion } from '../../mc/pack'
import { Icon } from '../common/Icon'
import { Modal, toast } from '../common/dialogs'
import { frameLabel } from './frameLabel'

/** Figura's emoji names shown as the closest real emoji in the preview. */
export const EMOJI: Record<string, string> = {
  smile: '😄', grin: '😁', blush: '😊', heart: '❤️', star: '⭐', sparkles: '✨', fox: '🦊', cat: '🐱', dog: '🐶',
  cry: '😢', sob: '😭', angry: '😠', rage: '😡', scream: '😱', thinking: '🤔', eyes: '👀', fire: '🔥', zzz: '💤',
  '+1': '👍', dragon: '🐉', sweat: '😅', wink: '😉', flushed: '😳', pensive: '😔', skull: '💀', sunglasses: '😎'
}

const strip = (id: string) => id.replace(/^minecraft:/, '')

/** Face (skin face + base + frame) as a data URL, cached per doc change. */
function useFaceIcon(doc: SkinDoc, frame: FaceFrame | null): string | null {
  return useMemo(() => (frame && (frame === 'base' || doc.faces[frame]) ? imgToDataUrl(faceWithFrame(doc, frame)) : null), [doc, frame, doc.faces[frame ?? 'base'], doc.composite])
}

/** A wheel icon as the game will draw it: real item render, uploaded picture, face or emoji. */
export function WheelIconView({ icon, doc, pack, size, auria }: { icon: WheelIcon; doc: SkinDoc; pack: McPack | null; size: number; auria: boolean }) {
  const itemId = icon.kind === 'item' ? icon.id : !auria && icon.kind === 'emoji' ? 'minecraft:name_tag' : undefined
  const itemUrl = useItemIcon(pack, itemId, 64)
  const faceUrl = useFaceIcon(doc, icon.kind === 'face' ? icon.frame : null)
  const style = { width: size, height: size }
  if (icon.kind === 'emoji' && auria) {
    const name = icon.text.replace(/:/g, '')
    return <span className="wicon emoji" style={{ ...style, fontSize: size * 0.78 }}>{EMOJI[name] ?? icon.text}</span>
  }
  const src = icon.kind === 'image' ? icon.src : icon.kind === 'face' ? faceUrl : itemUrl
  if (src) return <img className="wicon" src={src} style={style} alt="" draggable={false} />
  // item not in this version / pack not loaded yet
  const label = itemId ? strip(itemId) : '?'
  return (
    <span className="wicon missing" style={{ ...style, fontSize: Math.max(8, size / 3.4) }} title={itemId}>
      {label.split('_').map((w) => w[0]?.toUpperCase()).join('').slice(0, 3)}
    </span>
  )
}

/** Fit a picture into a size×size square: whole-pixel upscaling for pixel art, smooth shrinking otherwise. */
export async function fitIcon(src: string, size: IconSize): Promise<string> {
  const img = await loadImage(src)
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const s = Math.min(size / img.width, size / img.height)
  const k = s >= 1 ? Math.floor(s) : s
  g.imageSmoothingEnabled = k < 1
  g.imageSmoothingQuality = 'high'
  const w = Math.max(1, Math.round(img.width * k))
  const h = Math.max(1, Math.round(img.height * k))
  g.drawImage(img, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h)
  return c.toDataURL('image/png')
}

/** Notice + actions when a version's items aren't available yet. */
export function PackNotice({ state, version }: { state: PackState; version: McVersion }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  if (state.status === 'ready') return null
  if (state.status === 'loading') return <div className="pack-note muted">{t('icons.loading', { v: version })}</div>
  const download = async () => {
    setBusy(true)
    try {
      await downloadPack(version)
      toast(t('icons.downloaded', { v: version }))
    } catch (e) {
      toast(t('icons.downloadFailed', { e: String(e) }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="pack-note">
      <span>{state.status === 'error' ? state.message : t('icons.missing', { v: version })}</span>
      <button className="btn sm-btn" disabled={busy} onClick={download}>
        <Icon name="download" size={13} />
        {busy ? t('icons.downloading') : t('icons.download')}
      </button>
      <span className="muted" style={{ fontSize: 11 }}>{t('icons.downloadNote')}</span>
    </div>
  )
}

/** One grid cell; renders its icon only once scrolled into view. */
function ItemCell({ pack, id, name, on, onPick }: { pack: McPack; id: string; name: string; on: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setSeen(true), io.disconnect()), { rootMargin: '120px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const url = useItemIcon(seen ? pack : null, id, 64)
  return (
    <button ref={ref} className={'item-cell' + (on ? ' on' : '')} title={`${name}\nminecraft:${id}`} onClick={onPick}>
      {url ? <img src={url} alt="" draggable={false} /> : <span className="item-ph" />}
    </button>
  )
}

type Tab = 'item' | 'image' | 'face' | 'emoji'

/** Choose an icon: any Minecraft item, an uploaded picture, a face frame or an emoji. */
export function IconPicker({ doc, value, version, auria, onPick, onClose }: { doc: SkinDoc; value: WheelIcon; version: McVersion; auria: boolean; onPick: (i: WheelIcon) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const state = usePack(version)
  const pack = state.status === 'ready' ? state.pack : null
  const [tab, setTab] = useState<Tab>(value.kind)
  const [q, setQ] = useState('')
  const [upload, setUpload] = useState<{ src: string; w: number; h: number; name: string } | null>(null)
  const [size, setSize] = useState<IconSize>(value.kind === 'image' ? value.size : 32)
  const [fitted, setFitted] = useState<string | null>(value.kind === 'image' ? value.src : null)

  const items = useMemo(() => {
    if (!pack) return []
    const s = q.trim().toLowerCase().replace(/^minecraft:/, '')
    return s ? pack.items.filter((i) => i.id.includes(s.replace(/ /g, '_')) || i.name.toLowerCase().includes(s)) : pack.items
  }, [pack, q])

  useEffect(() => {
    if (!upload) return
    let live = true
    fitIcon(upload.src, size).then((u) => live && setFitted(u))
    return () => {
      live = false
    }
  }, [upload, size])

  const pickFile = async () => {
    const f = await storage.openImage()
    if (!f) return
    const img = await loadImage(f.dataUrl)
    const m = Math.max(img.width, img.height)
    setSize(m <= 16 ? 16 : m <= 32 ? 32 : m <= 64 ? 64 : 32)
    setUpload({ src: f.dataUrl, w: img.width, h: img.height, name: f.name })
  }
  const frames = allFrames(doc.figura).filter((f) => f !== 'talk' && (f === 'base' || doc.faces[f]))
  const bytes = fitted ? Math.round(((fitted.length - fitted.indexOf(',') - 1) * 3) / 4) : 0

  return (
    <Modal
      title={t('icons.title')}
      onClose={onClose}
      footer={
        <>
          {tab === 'image' && (
            <button className="btn primary" disabled={!fitted} onClick={() => fitted && onPick({ kind: 'image', src: fitted, size })}>
              {t('icons.useImage')}
            </button>
          )}
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </>
      }
    >
      <div className="icon-picker">
        <div className="seg">
          {(['item', 'image', 'face', 'emoji'] as Tab[]).map((k) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t('icons.tab_' + k)}</button>
          ))}
        </div>

        {tab === 'item' && (
          <>
            <div className="row">
              <input className="input grow" autoFocus placeholder={t('icons.search')} value={q} onChange={(e) => setQ(e.target.value)} />
              <span className="muted" style={{ fontSize: 12 }}>{pack ? t('icons.count', { n: items.length, v: version }) : ''}</span>
            </div>
            <PackNotice state={state} version={version} />
            {pack && (
              <div className="item-grid">
                {items.map((i) => (
                  <ItemCell key={i.id} pack={pack} id={i.id} name={i.name} on={value.kind === 'item' && strip(value.id) === i.id} onPick={() => onPick({ kind: 'item', id: 'minecraft:' + i.id })} />
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'image' && (
          <div className="col" style={{ gap: 10 }}>
            <button className="btn" onClick={pickFile}><Icon name="image" />{t('icons.chooseImage')}</button>
            <div className="field">
              <span className="label">{t('icons.size')}</span>
              <div className="seg">
                {ICON_SIZES.map((s) => (
                  <button key={s} className={size === s ? 'on' : ''} onClick={() => setSize(s)}>{s}×{s}</button>
                ))}
              </div>
              <span className="muted" style={{ fontSize: 11 }}>{t('icons.sizeHint')}</span>
            </div>
            {fitted && (
              <div className="row" style={{ gap: 16 }}>
                <img className="pix fit-preview" src={fitted} alt="" style={{ width: 96, height: 96 }} />
                <img className="pix fit-preview" src={fitted} alt="" style={{ width: 32, height: 32 }} />
                <span className="muted" style={{ fontSize: 12 }}>
                  {upload && t('icons.from', { w: upload.w, h: upload.h })}
                  <br />
                  {t('icons.bytes', { n: (bytes / 1024).toFixed(1) })}
                </span>
              </div>
            )}
          </div>
        )}

        {tab === 'face' && (
          <div className="face-picks">
            {frames.length === 0 && <span className="muted">{t('figura.noExprFrames')}</span>}
            {frames.map((f) => (
              <button key={f} className={'face-pick' + (value.kind === 'face' && value.frame === f ? ' on' : '')} onClick={() => onPick({ kind: 'face', frame: f })}>
                <WheelIconView icon={{ kind: 'face', frame: f }} doc={doc} pack={null} size={40} auria />
                <span>{frameLabel(t, doc.figura, f)}</span>
              </button>
            ))}
          </div>
        )}

        {tab === 'emoji' && (
          <>
            {!auria && <span className="muted" style={{ fontSize: 12 }}>{t('icons.emojiAuria')}</span>}
            <div className="face-picks">
              {Object.entries(EMOJI).map(([k, e]) => (
                <button key={k} className={'face-pick' + (value.kind === 'emoji' && value.text === `:${k}:` ? ' on' : '')} onClick={() => onPick({ kind: 'emoji', text: `:${k}:` })}>
                  <span style={{ fontSize: 26 }}>{e}</span>
                  <span>:{k}:</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

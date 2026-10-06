import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkinDoc } from '../../skin/doc'
import { RESOLUTIONS, type Variant } from '../../skin/layout'
import { cloneImg, composite, createImg, type Img } from '../../skin/pixels'
import { NO_ADJUST, type Adjust } from '../../skin/recolor'
import type { HairPlane } from '../../skin/hair'
import {
  CATEGORIES,
  composeLayers,
  deleteItemImage,
  itemImage,
  loadWardrobe,
  putItemImage,
  saveWardrobe,
  type WardrobeCategory,
  type WardrobeItem
} from '../../lib/wardrobe'
import { decodeSkin } from '../../lib/project'
import { storage } from '../../lib/storage'
import { readDroppedImages } from '../../lib/files'
import { confirmBox, toast } from '../common/dialogs'
import { Icon } from '../common/Icon'
import { ItemDialog } from './ItemDialog'
import { WardrobePreview } from './WardrobePreview'

type Selection = Partial<Record<WardrobeCategory, { id: string; adjust: Adjust }>>

// ---- library (grid + upload/edit/delete) — used in the window and on the Home screen ------
export function useLibrary() {
  const [items, setItems] = useState<WardrobeItem[] | null>(null)
  useEffect(() => {
    loadWardrobe().then(setItems)
  }, [])
  const update = (next: WardrobeItem[]) => {
    setItems(next)
    saveWardrobe(next)
  }
  return { items, update }
}

function ItemCard({ item, selected, onClick, onEdit, onDelete }: { item: WardrobeItem; selected?: boolean; onClick?: () => void; onEdit: () => void; onDelete: () => void }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)
  const press = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = () => {
    const r = ref.current!.getBoundingClientRect()
    setTip({ x: Math.min(r.right + 8, window.innerWidth - 250), y: Math.max(8, Math.min(r.top, window.innerHeight - 220)) })
  }
  return (
    <div
      ref={ref}
      className={'item-card' + (selected ? ' on' : '')}
      onClick={onClick}
      onMouseEnter={show}
      onMouseLeave={() => setTip(null)}
      // long-press shows the details on touch screens
      onPointerDown={(e) => e.pointerType !== 'mouse' && (press.current = setTimeout(show, 450))}
      onPointerUp={() => clearTimeout(press.current)}
    >
      <img src={item.thumb} alt="" draggable={false} />
      <div className="item-name" title={item.name}>{item.name}</div>
      <div className="item-res">{item.res}×{item.res}</div>
      {selected && <span className="item-check"><Icon name="check" size={12} stroke={3} /></span>}
      <div className="item-actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn sm" title={t('wardrobe.editItem')} onClick={onEdit}><Icon name="edit" size={13} /></button>
        <button className="icon-btn sm" title={t('common.delete')} onClick={onDelete}><Icon name="trash" size={13} /></button>
      </div>
      {tip && (
        <div className="item-tip" style={{ left: tip.x, top: tip.y }}>
          <b>{item.name}</b>
          <dl>
            <dt>{t('wardrobe.category')}</dt><dd>{t(`wardrobe.cat.${item.category}`)}</dd>
            <dt>{t('wardrobe.resolution')}</dt><dd>{item.res}×{item.res} · {item.variant === 'slim' ? 'Slim' : 'Wide'}</dd>
            <dt>{t('wardrobe.credit')}</dt><dd>{item.credit || t('common.none')}</dd>
            <dt>{t('wardrobe.usage')}</dt><dd>{t(`license.${item.license}`)}</dd>
            {item.license === 'commercial-mod' && (<><dt>{t('wardrobe.modify')}</dt><dd>{item.modifyPercent}%</dd></>)}
          </dl>
        </div>
      )}
    </div>
  )
}

export function WardrobeLibrary({
  items,
  update,
  selection,
  onToggle
}: {
  items: WardrobeItem[] | null
  update: (next: WardrobeItem[]) => void
  selection?: Selection
  onToggle?: (item: WardrobeItem) => void
}) {
  const { t } = useTranslation()
  const [cat, setCat] = useState<WardrobeCategory | 'all'>('all')
  const [edit, setEdit] = useState<WardrobeItem | null>(null)
  // uploads waiting for their details dialog (several files can be dropped at once)
  const [queue, setQueue] = useState<{ name: string; img: Img; variant: Variant }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const dialog = edit ? { item: edit } : queue[0] ? { upload: queue[0] } : null
  const closeDialog = () => (edit ? setEdit(null) : setQueue((q) => q.slice(1)))

  const addFiles = async (files: { name: string; dataUrl: string }[]) => {
    const ok: typeof queue = []
    for (const f of files) {
      const r = await decodeSkin(f.dataUrl)
      if (r.ok) ok.push({ name: f.name, img: r.img, variant: r.variant })
      else toast(`${f.name}: ${t('home.badSize', { w: r.w, h: r.h })}`)
    }
    setQueue((q) => [...q, ...ok])
  }

  const upload = async () => {
    const f = await storage.openImage()
    if (f) addFiles([f])
  }

  const shown = (items ?? []).filter((i) => cat === 'all' || i.category === cat)
  return (
    <div
      className={'wardrobe-lib drop-zone' + (dragOver ? ' over' : '')}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault()
        setDragOver(false)
        addFiles(await readDroppedImages(e.dataTransfer.files))
      }}
    >
      {dragOver && <div className="drop-hint"><Icon name="image" size={28} />{t('wardrobe.dropHere')}</div>}
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          <button className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>{t('wardrobe.all')}</button>
          {CATEGORIES.map((c) => (
            <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
              {t(`wardrobe.cat.${c}`)}
              {selection?.[c] && <span className="dot" style={{ background: 'var(--accent)', marginLeft: 5 }} />}
            </button>
          ))}
        </div>
        <div className="grow" />
        <span className="muted" style={{ fontSize: 12 }}>{t('wardrobe.dropHint')}</span>
        <button className="btn" onClick={upload}><Icon name="plus" />{t('wardrobe.upload')}</button>
      </div>
      {items && shown.length === 0 && <div className="empty" style={{ padding: '40px 0' }}>{t('wardrobe.empty')}</div>}
      <div className="item-grid">
        {shown.map((it) => (
          <ItemCard
            key={it.id}
            item={it}
            selected={selection?.[it.category]?.id === it.id}
            onClick={onToggle && (() => onToggle(it))}
            onEdit={() => setEdit(it)}
            onDelete={async () => {
              if (!(await confirmBox(t('wardrobe.confirmDelete', { name: it.name }), t('common.delete'), t('common.cancel'), true))) return
              update((items ?? []).filter((x) => x.id !== it.id))
              deleteItemImage(it.id)
            }}
          />
        ))}
      </div>
      {dialog && (
        <ItemDialog
          item={dialog.item}
          key={dialog.item?.id ?? queue.length}
          upload={dialog.upload}
          defaultCategory={cat === 'all' ? undefined : cat}
          onClose={closeDialog}
          onSave={async (item, img) => {
            if (img) await putItemImage(item.id, img)
            const list = items ?? []
            update(list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item])
            closeDialog()
          }}
        />
      )}
    </div>
  )
}

// ---- colour controls for one worn item ------------------------------------------------
function AdjustControls({ adjust, onChange }: { adjust: Adjust; onChange: (a: Adjust) => void }) {
  const { t } = useTranslation()
  const hsv = adjust.mode === 'hsv' ? adjust : { mode: 'hsv' as const, hue: 0, sat: 1, light: 0 }
  const grad = adjust.mode === 'gradient' ? adjust : { mode: 'gradient' as const, dark: '#2b1a3a', light: '#ffd6e8', mix: 1 }
  return (
    <div className="adjust">
      <div className="seg">
        <button className={adjust.mode === 'none' ? 'on' : ''} onClick={() => onChange(NO_ADJUST)}>{t('wardrobe.adjNone')}</button>
        <button className={adjust.mode === 'hsv' ? 'on' : ''} onClick={() => onChange(hsv)}>{t('wardrobe.adjHsv')}</button>
        <button className={adjust.mode === 'gradient' ? 'on' : ''} onClick={() => onChange(grad)}>{t('wardrobe.adjGradient')}</button>
      </div>
      {adjust.mode === 'hsv' && (
        <>
          <label className="phys-row"><span className="muted">{t('wardrobe.hue')}</span><input type="range" className="hue-range" min={-180} max={180} value={adjust.hue} onChange={(e) => onChange({ ...adjust, hue: +e.target.value })} /><span className="val">{adjust.hue}°</span></label>
          <label className="phys-row"><span className="muted">{t('wardrobe.sat')}</span><input type="range" min={0} max={2} step={0.05} value={adjust.sat} onChange={(e) => onChange({ ...adjust, sat: +e.target.value })} /><span className="val">{Math.round(adjust.sat * 100)}%</span></label>
          <label className="phys-row"><span className="muted">{t('wardrobe.light')}</span><input type="range" min={-0.6} max={0.6} step={0.02} value={adjust.light} onChange={(e) => onChange({ ...adjust, light: +e.target.value })} /><span className="val">{Math.round(adjust.light * 100)}</span></label>
        </>
      )}
      {adjust.mode === 'gradient' && (
        <>
          <div className="row">
            <label className="row muted grow">{t('wardrobe.dark')}<input type="color" value={adjust.dark} onChange={(e) => onChange({ ...adjust, dark: e.target.value })} /></label>
            <label className="row muted grow">{t('wardrobe.lightColor')}<input type="color" value={adjust.light} onChange={(e) => onChange({ ...adjust, light: e.target.value })} /></label>
          </div>
          <div className="grad-bar" style={{ background: `linear-gradient(90deg, ${adjust.dark}, ${adjust.light})` }} />
          <label className="phys-row"><span className="muted">{t('wardrobe.mix')}</span><input type="range" min={0} max={1} step={0.05} value={adjust.mix} onChange={(e) => onChange({ ...adjust, mix: +e.target.value })} /><span className="val">{Math.round(adjust.mix * 100)}%</span></label>
        </>
      )}
    </div>
  )
}

// ---- the window --------------------------------------------------------------------------
export function WardrobeWindow({ doc, onClose, onCreate }: { doc?: SkinDoc; onClose: () => void; onCreate?: (doc: SkinDoc) => void }) {
  const { t } = useTranslation()
  const lib = useLibrary()
  const items = lib.items ?? []
  const [sel, setSel] = useState<Selection>({})
  const [name, setName] = useState(t('newSkin.defaultName'))
  const [res, setRes] = useState(doc?.res ?? 64)
  const [variant, setVariant] = useState<Variant>(doc?.variant ?? 'wide')
  const [preview, setPreview] = useState<Img>(() => (doc ? cloneImg(doc.composite) : createImg(64, 64)))
  const [hair, setHair] = useState<HairPlane[]>([])

  const picks = useMemo(() => Object.values(sel).flatMap((s) => {
    const item = items.find((i) => i.id === s!.id)
    return item ? [{ item, adjust: s!.adjust }] : []
  }), [sel, items])

  // recompose the try-on preview whenever the outfit or its colours change
  useEffect(() => {
    let stale = false
    ;(async () => {
      const loaded = []
      for (const p of picks) {
        const img = await itemImage(p.item.id)
        if (img) loaded.push({ ...p, img })
      }
      const layers = composeLayers(loaded, res)
      const out = createImg(res, res)
      const base = doc ? [{ img: doc.composite, visible: true, opacity: 1 }] : []
      composite([...base, ...layers.map((l) => ({ img: l.img, visible: true, opacity: 1 }))], out)
      if (!stale) {
        setPreview(out)
        setHair(doc ? doc.hair : [])
      }
    })()
    return () => {
      stale = true
    }
  }, [picks, res, doc])

  const toggle = (it: WardrobeItem) =>
    setSel((s) => ({ ...s, [it.category]: s[it.category]?.id === it.id ? undefined : { id: it.id, adjust: NO_ADJUST } }))

  const apply = async () => {
    const loaded = []
    for (const p of picks) {
      const img = await itemImage(p.item.id)
      if (img) loaded.push({ ...p, img })
    }
    const layers = composeLayers(loaded, res)
    if (doc) {
      for (const l of layers) doc.addLayer(l.name, l.img, l.meta)
      onClose()
      return
    }
    const d = new SkinDoc({ name: name.trim() || t('newSkin.defaultName'), res, variant })
    d.initLayers(layers.length ? layers.map((l) => d.makeLayer(l.name, l.img, l.meta)) : [d.makeLayer(t('layers.base'))])
    onCreate?.(d)
  }

  return (
    <div className="modal-back">
      <div className="wardrobe">
        <header className="wardrobe-head">
          <Icon name="shirt" size={18} />
          <b>{t('wardrobe.title')}</b>
          <div className="grow" />
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="wardrobe-body">
          <div className="wardrobe-left">
            <WardrobePreview img={preview} variant={variant} hair={hair} />
            <div className="hint-bar" style={{ position: 'static', padding: '6px 10px' }}>{t('wardrobe.viewHint')}</div>
          </div>
          <div className="wardrobe-right">
            <WardrobeLibrary items={lib.items} update={lib.update} selection={sel} onToggle={toggle} />
            <div className="worn">
              <span className="label">{t('wardrobe.selected')}</span>
              {picks.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('wardrobe.noneSelected')}</span>}
              {picks.map((p) => (
                <div key={p.item.id} className="worn-item">
                  <div className="row">
                    <img src={p.item.thumb} alt="" />
                    <div className="grow">
                      <b>{p.item.name}</b>
                      <div className="muted" style={{ fontSize: 11 }}>{t(`wardrobe.cat.${p.item.category}`)} · {p.item.credit || t('common.none')}</div>
                    </div>
                    <button className="icon-btn sm" onClick={() => toggle(p.item)}><Icon name="x" size={13} /></button>
                  </div>
                  <AdjustControls adjust={p.adjust} onChange={(a) => setSel((s) => ({ ...s, [p.item.category]: { id: p.item.id, adjust: a } }))} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <footer className="wardrobe-foot">
          {!doc && (
            <>
              <input className="input" style={{ width: 200 }} value={name} onChange={(e) => setName(e.target.value)} />
              <select className="select" value={res} onChange={(e) => setRes(Number(e.target.value))}>
                {RESOLUTIONS.map((r) => (
                  <option key={r} value={r}>{r}×{r}</option>
                ))}
              </select>
              <div className="seg">
                {(['wide', 'slim'] as Variant[]).map((v) => (
                  <button key={v} className={variant === v ? 'on' : ''} onClick={() => setVariant(v)}>{t(`model.${v}`)}</button>
                ))}
              </div>
            </>
          )}
          <span className="muted" style={{ fontSize: 12 }}>{t('wardrobe.applyHint')}</span>
          <div className="grow" />
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={apply}>{t('wardrobe.apply')}</button>
        </footer>
      </div>
    </div>
  )
}

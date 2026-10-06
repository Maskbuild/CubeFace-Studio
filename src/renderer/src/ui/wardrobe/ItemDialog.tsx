import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { newId, type License } from '../../skin/doc'
import type { Variant } from '../../skin/layout'
import type { Img } from '../../skin/pixels'
import { CATEGORIES, type WardrobeCategory, type WardrobeItem } from '../../lib/wardrobe'
import { renderThumbnail } from '../../three/thumbnail'
import { Modal } from '../common/dialogs'

const LICENSES: License[] = ['free', 'commercial-nomod', 'commercial-mod', 'exclusive']

/** Create (with a freshly uploaded image) or edit a wardrobe item's details. */
export function ItemDialog({
  item,
  upload,
  defaultCategory,
  onClose,
  onSave
}: {
  item?: WardrobeItem
  upload?: { name: string; img: Img; variant: Variant }
  defaultCategory?: WardrobeCategory
  onClose: () => void
  onSave: (item: WardrobeItem, img?: Img) => void
}) {
  const { t } = useTranslation()
  const [f, setF] = useState<WardrobeItem>(
    () =>
      item ?? {
        id: newId(),
        name: upload!.name,
        category: defaultCategory ?? 'outfit',
        res: upload!.img.w,
        variant: upload!.variant,
        credit: '',
        license: 'free',
        modifyPercent: 100,
        createdAt: Date.now(),
        thumb: renderThumbnail(upload!.img, upload!.variant, 160)
      }
  )

  return (
    <Modal
      title={item ? t('wardrobe.editItem') : t('wardrobe.upload')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={() => onSave({ ...f, name: f.name.trim() || 'Item' }, upload?.img)}>{t('common.save')}</button>
        </>
      }
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
        <img src={f.thumb} alt="" className="item-thumb-lg checker" />
        <div className="field grow">
          <label className="field">
            <span className="label">{t('newSkin.name')}</span>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">{t('wardrobe.category')}</span>
            <select className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as WardrobeCategory })}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(`wardrobe.cat.${c}`)}</option>
              ))}
            </select>
          </label>
          <span className="muted" style={{ fontSize: 12 }}>
            {f.res}×{f.res} · {f.variant === 'slim' ? 'Slim' : 'Wide'}
          </span>
        </div>
      </div>
      <label className="field">
        <span className="label">{t('wardrobe.credit')}</span>
        <input className="input" placeholder={t('common.none')} value={f.credit} onChange={(e) => setF({ ...f, credit: e.target.value })} />
      </label>
      <label className="field">
        <span className="label">{t('wardrobe.usage')}</span>
        <select className="select" value={f.license} onChange={(e) => setF({ ...f, license: e.target.value as License })}>
          {LICENSES.map((l) => (
            <option key={l} value={l}>{t(`license.${l}`)}</option>
          ))}
        </select>
      </label>
      {f.license === 'commercial-mod' && (
        <label className="field">
          <span className="label">{t('layers.modifyPercent')}: {f.modifyPercent}%</span>
          <input type="range" min={0} max={100} value={f.modifyPercent} onChange={(e) => setF({ ...f, modifyPercent: Number(e.target.value) })} />
        </label>
      )}
    </Modal>
  )
}

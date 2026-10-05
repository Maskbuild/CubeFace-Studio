import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RESOLUTIONS, type Variant } from '../../skin/layout'
import { Modal } from '../common/dialogs'

export interface NewSkinOpts {
  name: string
  res: number
  variant: Variant
  template: 'blank' | 'mannequin'
}

export function NewSkinDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (o: NewSkinOpts) => void }) {
  const { t } = useTranslation()
  const [o, setO] = useState<NewSkinOpts>({ name: t('newSkin.defaultName'), res: 64, variant: 'wide', template: 'mannequin' })
  const submit = () => onCreate({ ...o, name: o.name.trim() || t('newSkin.defaultName') })
  return (
    <Modal
      title={t('newSkin.title')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={submit}>{t('common.create')}</button>
        </>
      }
    >
      <label className="field">
        <span className="label">{t('newSkin.name')}</span>
        <input className="input" autoFocus value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </label>
      <div className="field">
        <span className="label">{t('newSkin.resolution')}</span>
        <div className="seg">
          {RESOLUTIONS.map((r) => (
            <button key={r} className={o.res === r ? 'on' : ''} onClick={() => setO({ ...o, res: r })}>{r}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">{t('newSkin.model')}</span>
        <div className="seg">
          {(['wide', 'slim'] as Variant[]).map((v) => (
            <button key={v} className={o.variant === v ? 'on' : ''} onClick={() => setO({ ...o, variant: v })}>{t(`model.${v}`)}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">{t('newSkin.template')}</span>
        <div className="seg">
          {(['mannequin', 'blank'] as const).map((v) => (
            <button key={v} className={o.template === v ? 'on' : ''} onClick={() => setO({ ...o, template: v })}>{t(`newSkin.${v}`)}</button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

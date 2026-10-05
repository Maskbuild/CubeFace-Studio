import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { decodePreset, loadPresets, presetFromHair, savePresets, type FiguraPreset } from '../../lib/presets'
import { confirmBox, Modal, toast } from './dialogs'
import { Icon } from './Icon'

/**
 * Global Figura preset library. With a document, each preset can be toggled on/off for that
 * skin; without one (Home screen) presets can be renamed and deleted.
 */
export function PresetList({ doc }: { doc?: SkinDoc }) {
  const { t } = useTranslation()
  const [list, setList] = useState<FiguraPreset[] | null>(null)
  const [name, setName] = useState('')
  const [, force] = useState(0)

  useEffect(() => {
    loadPresets().then(setList)
  }, [])
  useEffect(() => doc?.on((e) => e.type === 'structure' && force((n) => n + 1)), [doc])

  const update = (next: FiguraPreset[]) => {
    setList(next)
    savePresets(next)
  }

  const own = doc?.hair.filter((h) => !h.presetId) ?? []
  const saveCurrent = () => {
    if (!doc || !own.length) return
    const p = presetFromHair(name.trim() || doc.name, own)
    update([...(list ?? []), p])
    setName('')
    toast(t('presets.saved', { name: p.name }))
  }

  const toggle = async (p: FiguraPreset) => {
    if (!doc) return
    if (doc.hair.some((h) => h.presetId === p.id)) doc.removePreset(p.id)
    else doc.applyPreset(p.id, await decodePreset(p))
  }

  return (
    <div className="preset-list">
      {doc && (
        <div className="row">
          <input className="input grow" placeholder={t('presets.name')} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" disabled={!own.length} title={own.length ? '' : t('presets.nothing')} onClick={saveCurrent}>
            <Icon name="save" />
            {t('presets.saveCurrent')}
          </button>
        </div>
      )}
      {list && list.length === 0 && <div className="muted">{t('presets.empty')}</div>}
      {list?.map((p) => {
        const on = !!doc?.hair.some((h) => h.presetId === p.id)
        return (
          <div key={p.id} className="palette-row row">
            {doc && <input type="checkbox" checked={on} onChange={() => toggle(p)} title={t('presets.toggle')} />}
            <input className="input grow" value={p.name} onChange={(e) => update(list.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))} />
            <span className="tag">{t('presets.planes', { n: p.hair.length })}</span>
            <button
              className="icon-btn"
              title={t('common.delete')}
              onClick={async () => (await confirmBox(`${t('common.delete')} "${p.name}"?`, t('common.delete'), t('common.cancel'), true)) && update(list.filter((x) => x.id !== p.id))}
            >
              <Icon name="trash" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function FiguraPresetsDialog({ doc, onClose }: { doc: SkinDoc; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Modal title={t('hair.presets')} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>{t('common.close')}</button>}>
      <div className="muted" style={{ fontSize: 12 }}>{t('presets.help')}</div>
      <PresetList doc={doc} />
    </Modal>
  )
}

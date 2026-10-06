import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { applyFaceSet, faceSetFrom, loadFaceSets, saveFaceSets, type FaceSet } from '../../lib/faceSets'
import { Icon } from '../common/Icon'
import { confirmBox, promptBox, toast } from '../common/dialogs'

/** Wardrobe-style window of saved face sets: save the current face, apply, rename, delete. */
export function FaceSetWindow({ doc, onClose }: { doc: SkinDoc; onClose: () => void }) {
  const { t } = useTranslation()
  const [list, setList] = useState<FaceSet[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => void loadFaceSets().then(setList), [])
  const save = (next: FaceSet[]) => {
    setList(next)
    saveFaceSets(next)
  }
  const chosen = list?.find((x) => x.id === sel) ?? null
  const hasFrames = Object.keys(doc.faces).length > 0

  const saveCurrent = async () => {
    const name = (await promptBox(t('faceSets.name'), t('faceSets.defaultName', { n: (list?.length ?? 0) + 1 }), t('common.save'), t('common.cancel')))?.trim()
    if (!name) return
    const set = faceSetFrom(doc, name)
    save([...(list ?? []), set])
    setSel(set.id)
    toast(t('faceSets.saved', { name }))
  }
  const apply = async (set: FaceSet) => {
    if (hasFrames && !(await confirmBox(t('faceSets.replace'), t('faceSets.apply'), t('common.cancel')))) return
    await applyFaceSet(doc, set)
    toast(t('faceSets.applied', { name: set.name }))
    onClose()
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wardrobe" style={{ gridTemplateRows: 'auto 1fr auto' }}>
        <header className="wardrobe-head">
          <Icon name="smile" size={18} />
          <b>{t('faceSets.title')}</b>
          <div className="grow" />
          <button className="btn" disabled={!hasFrames} onClick={saveCurrent}><Icon name="save" />{t('faceSets.saveCurrent')}</button>
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="wardrobe-right" style={{ padding: 16 }}>
          <span className="muted" style={{ fontSize: 12 }}>{t('faceSets.help')}</span>
          {list && list.length === 0 && <div className="empty small">{t('faceSets.empty')}</div>}
          <div className="item-grid">
            {(list ?? []).map((x) => (
              <div key={x.id} className={'item-card' + (sel === x.id ? ' on' : '')} onClick={() => setSel(x.id)} onDoubleClick={() => apply(x)}>
                <img src={x.thumb} alt="" className="face-set-thumb" draggable={false} />
                <div className="item-name" title={x.name}>{x.name}</div>
                <div className="item-res">{x.res}×{x.res} · {t('faceSets.frames', { n: Object.keys(x.frames).length })}</div>
              </div>
            ))}
          </div>
        </div>
        <footer className="wardrobe-foot">
          {chosen && (
            <>
              <button
                className="btn sm-btn"
                onClick={async () => {
                  const name = (await promptBox(t('common.rename'), chosen.name, t('common.ok'), t('common.cancel')))?.trim()
                  if (name) save(list!.map((x) => (x.id === chosen.id ? { ...x, name } : x)))
                }}
              >
                {t('common.rename')}
              </button>
              <button
                className="btn sm-btn danger"
                onClick={async () => (await confirmBox(t('faceSets.delete', { name: chosen.name }), t('common.delete'), t('common.cancel'), true)) && (save(list!.filter((x) => x.id !== chosen.id)), setSel(null))}
              >
                <Icon name="trash" size={13} />
                {t('common.delete')}
              </button>
            </>
          )}
          <div className="grow" />
          <button className="btn" onClick={onClose}>{t('common.close')}</button>
          <button className="btn primary" disabled={!chosen} onClick={() => chosen && apply(chosen)}>{t('faceSets.apply')}</button>
        </footer>
      </div>
    </div>
  )
}

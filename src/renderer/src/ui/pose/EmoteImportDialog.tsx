import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Emote } from '../../pose/emote'
import { defaultRights, type Rights } from '../../skin/rights'
import { Modal } from '../common/dialogs'
import { RightsEditor } from '../common/RightsEditor'
import { EmotePreview } from './EmotePreview'
import { Icon } from '../common/Icon'
import { storage } from '../../lib/storage'
import { squareLogo } from '../../pose/library'

/**
 * New emotes, one at a time: a still preview (no turntable), the name, and where it came from
 * with what may be done with it. "Same for all" applies the rights to the rest of the batch.
 */
export function EmoteImportDialog({ queue, onAdd, onClose }: { queue: Emote[]; onAdd: (list: Emote[]) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const e = queue[0]
  const [name, setName] = useState(e.name)
  const [rights, setRights] = useState<Rights>(e.rights ?? defaultRights())
  const [all, setAll] = useState(false)
  // .emotecraft files bring their own icon; JSON emotes can get one here
  const [icon, setIcon] = useState<string | undefined>(e.icon)
  const pickLogo = async () => {
    const f = await storage.openImage()
    if (f) setIcon(await squareLogo(f.dataUrl))
  }
  const left = queue.length - 1
  return (
    <Modal
      title={t('rights.emoteTitle') + (left ? ` (1/${queue.length})` : '')}
      onClose={onClose}
      footer={
        <>
          {left > 0 && (
            <label className="row" style={{ fontSize: 12, marginRight: 'auto' }}>
              <input type="checkbox" checked={all} onChange={(ev) => setAll(ev.target.checked)} />
              {t('rights.applyAll', { n: queue.length })}
            </label>
          )}
          <button className="btn" onClick={() => onAdd([])}>{t('pose.skip')}</button>
          <button
            className="btn primary"
            onClick={() => onAdd(all ? queue.map((x, i) => ({ ...x, ...(i === 0 ? { name: name.trim() || x.name, icon } : {}), rights })) : [{ ...e, name: name.trim() || e.name, icon, rights }])}
          >
            {t('pose.addEmote')}
          </button>
        </>
      }
    >
      <div className="emote-import">
        <EmotePreview emote={e} spin={false} />
        <div className="emote-import-side">
          <label className="field">
            <span className="label">{t('rights.name')}</span>
            <input className="input" value={name} onChange={(ev) => setName(ev.target.value)} />
          </label>
          {e.author && <span className="muted" style={{ fontSize: 12 }}>{t('pose.by', { author: e.author })}</span>}
          <div className="row" style={{ gap: 10 }}>
            {icon ? <img src={icon} alt="" className="emote-logo checker" /> : <span className="emote-logo emote-ph" />}
            <div className="col" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button className="btn sm-btn" onClick={pickLogo}><Icon name="image" size={13} />{icon ? t('pose.changeLogo') : t('pose.addLogo')}</button>
              {icon && <button className="btn sm-btn" onClick={() => setIcon(undefined)}>{t('pose.removeLogo')}</button>}
              <span className="muted" style={{ fontSize: 11 }}>{e.icon ? t('pose.logoFromFile') : t('pose.logoHint')}</span>
            </div>
          </div>
          <RightsEditor value={rights} onChange={setRights} />
        </div>
      </div>
    </Modal>
  )
}

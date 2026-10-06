import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Emote } from '../../pose/emote'
import { defaultRights, type Rights } from '../../skin/rights'
import { Modal } from '../common/dialogs'
import { RightsEditor } from '../common/RightsEditor'
import { EmotePreview } from './EmotePreview'

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
            onClick={() => onAdd(all ? queue.map((x, i) => ({ ...x, name: i === 0 ? name.trim() || x.name : x.name, rights })) : [{ ...e, name: name.trim() || e.name, rights }])}
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
          <RightsEditor value={rights} onChange={setRights} />
        </div>
      </div>
    </Modal>
  )
}

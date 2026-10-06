import { useTranslation } from 'react-i18next'
import { canRedistribute, SOURCES, type Rights } from '../../skin/rights'
import { Icon } from './Icon'

/**
 * Where something came from and what you may do with it. "Made by me" and "exclusive rights"
 * mean you may do anything, so the other choices only show for free / bought items.
 */
export function RightsEditor({ value, onChange }: { value: Rights; onChange: (r: Rights) => void }) {
  const { t } = useTranslation()
  const owned = value.source === 'own' || value.source === 'exclusive'
  return (
    <div className="rights">
      <span className="label">{t('rights.source')}</span>
      <div className="seg rights-seg">
        {SOURCES.map((s) => (
          <button key={s} className={value.source === s ? 'on' : ''} onClick={() => onChange({ ...value, source: s })}>{t('rights.src_' + s)}</button>
        ))}
      </div>
      {owned ? (
        <span className="muted" style={{ fontSize: 12 }}>{t('rights.ownHint')}</span>
      ) : (
        <>
          <label className="row"><input type="checkbox" checked={value.commercial} onChange={(e) => onChange({ ...value, commercial: e.target.checked })} />{t('rights.commercial')}</label>
          <label className="row"><input type="checkbox" checked={value.redistribute} onChange={(e) => onChange({ ...value, redistribute: e.target.checked })} />{t('rights.redistribute')}</label>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <span className="muted">{t('rights.modify')}</span>
            <div className="seg">
              {(['yes', 'limited', 'no'] as const).map((m) => (
                <button key={m} className={value.modify === m ? 'on' : ''} onClick={() => onChange({ ...value, modify: m })}>{t('rights.mod_' + m)}</button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** Small badges for cards: source and what is allowed. */
export function RightsBadges({ value }: { value?: Rights }) {
  const { t } = useTranslation()
  if (!value) return <span className="rights-badge muted">{t('rights.unset')}</span>
  const owned = value.source === 'own' || value.source === 'exclusive'
  return (
    <span className="rights-badges">
      <span className="rights-badge">{t('rights.src_' + value.source)}</span>
      {!owned && value.commercial && <span className="rights-badge" title={t('rights.commercial')}>$</span>}
      {!owned && !canRedistribute(value) && <span className="rights-badge warn" title={t('rights.noRedistribute')}><Icon name="lock" size={10} /></span>}
    </span>
  )
}

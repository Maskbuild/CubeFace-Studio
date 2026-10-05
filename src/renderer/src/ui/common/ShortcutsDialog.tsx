import { useTranslation } from 'react-i18next'
import { SHORTCUTS } from '../../lib/shortcuts'
import { Modal } from './dialogs'

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Modal title={t('keys.title')} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>{t('common.close')}</button>}>
      <div className="keys-grid">
        {SHORTCUTS.map((g) => (
          <div key={g.group}>
            <div className="label" style={{ marginBottom: 6 }}>{t(`keys.groups.${g.group}`)}</div>
            {g.items.map(([k, label]) => (
              <div key={label} className="keys-row">
                <span>{t(`keys.${label}`)}</span>
                <span className="kbd">{k}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  )
}

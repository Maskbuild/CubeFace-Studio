import { useTranslation } from 'react-i18next'
import { ACCENTS, useSettings, type ThemeMode } from '../../store/settings'
import { Modal } from '../common/dialogs'
import { Icon } from '../common/Icon'
import logo from '../../assets/logo.png'
import { MANUAL_EN, MANUAL_TH, REPO_URL } from '../../lib/links'

const SWATCH: Record<string, string> = { mono: 'linear-gradient(135deg,#fff 50%,#111 50%)', aqua: '#14b8c6', rose: '#e8558a', violet: '#8a6cf0', mint: '#2fbf83', amber: '#e89a1c' }

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const s = useSettings()
  const modes: [ThemeMode, string][] = [['system', 'monitor'], ['light', 'sun'], ['dark', 'moon']]
  return (
    <Modal title={t('settings.title')} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>{t('common.close')}</button>}>
      <div className="field">
        <span className="label">{t('settings.theme')}</span>
        <div className="seg">
          {modes.map(([m, icon]) => (
            <button key={m} className={s.theme === m ? 'on' : ''} onClick={() => s.set({ theme: m })}>
              <span className="row" style={{ gap: 6 }}><Icon name={icon} size={14} />{t(`settings.${m}`)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">{t('settings.accent')}</span>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {ACCENTS.map((a) => (
            <button key={a} className="btn" onClick={() => s.set({ accent: a })} style={{ borderColor: s.accent === a ? 'var(--accent)' : undefined, borderWidth: s.accent === a ? 2 : 1 }}>
              <span style={{ width: 14, height: 14, borderRadius: 99, background: SWATCH[a], border: '1px solid rgba(0,0,0,.2)' }} />
              {t(`accent.${a}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">{t('ui.uiScale')}</span>
        <div className="seg">
          {[0.9, 1, 1.1, 1.25, 1.5].map((z) => (
            <button key={z} className={s.uiScale === z ? 'on' : ''} onClick={() => s.set({ uiScale: z })}>{Math.round(z * 100)}%</button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">{t('settings.language')}</span>
        <div className="seg">
          <button className={s.lang === 'th' ? 'on' : ''} onClick={() => s.set({ lang: 'th' })}>ไทย</button>
          <button className={s.lang === 'en' ? 'on' : ''} onClick={() => s.set({ lang: 'en' })}>English</button>
        </div>
      </div>
      <div className="about">
        <img src={logo} alt="" />
        <div>
          <b>{t('app.title')}</b> <span className="muted">v{__APP_VERSION__}</span>
          <div className="muted">{t('app.by')}</div>
          <div className="muted" style={{ fontSize: 11 }}>{t('app.aiNote')}</div>
          <div className="row" style={{ gap: 10, marginTop: 4 }}>
            <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a href={s.lang === 'th' ? MANUAL_TH : MANUAL_EN} target="_blank" rel="noreferrer">{t('app.manual')}</a>
          </div>
        </div>
      </div>
    </Modal>
  )
}

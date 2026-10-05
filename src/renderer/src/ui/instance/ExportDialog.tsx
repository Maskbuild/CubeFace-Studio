import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { toEnglish } from '../../skin/figura'
import { buildAvatar } from '../../figura/avatar'
import { buildMcpack } from '../../bedrock/pack'
import { exportFileName } from '../../lib/project'
import { imgToDataUrl } from '../../lib/png'
import { storage } from '../../lib/storage'
import { avatarMeta } from '../figura/FiguraPanel'
import { Modal, toast } from '../common/dialogs'
import { Icon } from '../common/Icon'

type Kind = 'png' | 'figura' | 'bedrock'
const KINDS: [Kind, string][] = [
  ['png', 'image'],
  ['figura', 'sparkle'],
  ['bedrock', 'download']
]

/** One place to export: skin PNG, Figura avatar folder, or Bedrock .mcpack. Output text is English. */
export function ExportDialog({ doc, onClose }: { doc: SkinDoc; onClose: () => void }) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<Kind>('figura')
  const [busy, setBusy] = useState(false)
  const c = doc.figura
  const meta = avatarMeta(doc)
  const nonEnglish = [c.avatarName, c.author, c.description].some((s) => s && toEnglish(s) !== s.trim())

  const run = async () => {
    setBusy(true)
    try {
      if (kind === 'png') {
        const p = await storage.savePng(imgToDataUrl(doc.composite), exportFileName(meta.name))
        if (p) toast(t('export.saved', { path: p }))
      } else if (kind === 'figura') {
        const dir = await storage.exportFigura(meta.name, (await buildAvatar(doc, meta)).files)
        if (dir) toast(t('figura.exported', { dir }))
      } else {
        const p = await storage.saveFile(buildMcpack(doc, meta), exportFileName(meta.name).replace(/\.png$/, '.mcpack'), 'mcpack', 'Minecraft resource pack')
        if (p) toast(t('export.saved', { path: p }))
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('export.title')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={busy} onClick={run}><Icon name="download" />{busy ? t('figura.calculating') : t('common.export')}</button>
        </>
      }
    >
      <div className="export-kinds">
        {KINDS.map(([k, icon]) => (
          <button key={k} className={'export-kind' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>
            <Icon name={icon} size={20} />
            <b>{t(`export.${k}`)}</b>
            <span className="muted">{t(`export.${k}Hint`)}</span>
          </button>
        ))}
      </div>
      {kind !== 'png' && (
        <>
          <label className="field">
            <span className="label">{t('figura.avatarName')}</span>
            <input className="input" placeholder={meta.name} value={c.avatarName} onChange={(e) => doc.updateFigura({ avatarName: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">{t('figura.author')}</span>
            <input className="input" value={c.author} onChange={(e) => doc.updateFigura({ author: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">{t('figura.description')}</span>
            <input className="input" value={c.description} onChange={(e) => doc.updateFigura({ description: e.target.value })} />
          </label>
          <span className={nonEnglish ? 'size-warn' : 'muted'} style={{ fontSize: 12 }}>{t('figura.englishOnly')}</span>
        </>
      )}
      {kind === 'bedrock' && <div className="export-note">{t('export.bedrockNote')}</div>}
    </Modal>
  )
}

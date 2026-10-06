import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { toEnglish } from '../../skin/figura'
import { buildAvatar, creditLine } from '../../figura/avatar'
import { buildMcpack } from '../../bedrock/pack'
import { exportFileName } from '../../lib/project'
import { imgToDataUrl } from '../../lib/png'
import { storage, type AvatarMeta } from '../../lib/storage'
import { avatarMeta } from '../figura/FiguraPanel'
import { AttachWindow } from '../figura/AvatarLibrary'
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
  // Figura to include: starts with the ones shown with this skin; any library avatar can be added
  const [lib, setLib] = useState<AvatarMeta[]>([])
  const [include, setInclude] = useState<string[]>(() => doc.figura.attached.filter((a) => a.enabled).map((a) => a.id))
  const [together, setTogether] = useState<'separate' | 'merge'>('merge')
  const [asZip, setAsZip] = useState(true)
  const [picking, setPicking] = useState(false)
  useEffect(() => {
    storage.listAvatars().then(setLib)
  }, [picking])
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
        const files = (await buildAvatar(doc, meta)).files
        if (asZip) {
          // one .zip ready to share (credits for separate avatars go in this avatar.json)
          if (include.length && together === 'separate') {
            const info = JSON.parse(files['avatar.json'] as string)
            const credits = include.map((id) => lib.find((a) => a.id === id)).filter((a): a is AvatarMeta => !!a).map((a) => creditLine(a.authors, a.name))
            files['avatar.json'] = JSON.stringify({ ...info, authors: [...(info.authors ?? []), ...credits] }, null, 2)
          }
          const path = await storage.exportFiguraZip(meta.name, files, include, together === 'merge')
          if (path) toast(t('export.saved', { path }))
        } else if (include.length && together === 'merge') {
          // one avatar: this skin plus the chosen Figura, clashing file names renamed
          const r = await storage.mergeAvatars(include, { name: meta.name, files }, meta.name)
          if (r) toast(t('figura.merged', { n: r.count, dir: r.out, r: r.renamed.length ? r.renamed.map((x) => `${x.from} → ${x.to}`).join(', ') : t('figura.none') }))
        } else {
          // the chosen Figura come out next to this one, each in its own folder; this avatar
          // credits them after the owner as "<authors> - <avatar name>"
          if (include.length) {
            const info = JSON.parse(files['avatar.json'] as string)
            const credits = include.map((id) => lib.find((a) => a.id === id)).filter((a): a is AvatarMeta => !!a).map((a) => creditLine(a.authors, a.name))
            files['avatar.json'] = JSON.stringify({ ...info, authors: [...(info.authors ?? []), ...credits] }, null, 2)
          }
          const dir = await storage.exportFigura(meta.name, files, include)
          if (dir) toast(t('figura.exported', { dir }))
        }
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
      {kind === 'figura' && (
        <>
          {c.skinParts === 'all' && <div className="field">
            <span className="label">{t('figura.hideVanilla')}</span>
            <div className="seg">
              <button className={c.hideVanilla === 'used' ? 'on' : ''} onClick={() => doc.updateFigura({ hideVanilla: 'used' })}>{t('figura.hideUsed')}</button>
              <button className={c.hideVanilla === 'all' ? 'on' : ''} onClick={() => doc.updateFigura({ hideVanilla: 'all' })}>{t('figura.hideAll')}</button>
            </div>
          </div>}
          <div className="field">
            <span className="label">{t('export.scriptOptions')}</span>
            <div className="script-opts">
              {(['hideArmor', 'hideCape', 'hideElytra', 'dummyEvents'] as const).map((k) => (
                <label key={k} className="row switch-row" title={t('export.' + k + 'Hint')}>
                  <span className="grow">{t('export.' + k)}</span>
                  <input type="checkbox" className="switch" checked={!!c[k]} onChange={(e) => doc.updateFigura({ [k]: e.target.checked })} />
                </label>
              ))}
            </div>
          </div>
          <label className="row" title={t('export.zipHint')}>
            <input type="checkbox" checked={asZip} onChange={(e) => setAsZip(e.target.checked)} />
            {t('export.asZip')}
          </label>
          <div className="field">
            <div className="section-head">
              <span className="label">{t('export.includeFigura')}</span>
              <button className="btn sm-btn" onClick={() => setPicking(true)}><Icon name="plus" size={13} />{t('figura.addFigura')}</button>
            </div>
            {include.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('export.includeNone')}</span>}
            {include.map((id) => {
              const a = lib.find((x) => x.id === id)
              return (
                <div key={id} className="layer">
                  {a?.thumb3d || a?.thumb ? <img className="lthumb" src={a.thumb3d ?? a.thumb!} alt="" /> : <span className="lthumb" />}
                  <span className="lname">{a?.name ?? t('figura.missingAvatar')}</span>
                  <button className="icon-btn sm" onClick={() => setInclude(include.filter((x) => x !== id))}><Icon name="x" size={13} /></button>
                </div>
              )
            })}
            {include.length > 0 && (
              <div className="seg">
                <button className={together === 'separate' ? 'on' : ''} onClick={() => setTogether('separate')}>{t('export.separate')}</button>
                <button className={together === 'merge' ? 'on' : ''} onClick={() => setTogether('merge')}>{t('export.mergeOne')}</button>
              </div>
            )}
          </div>
        </>
      )}
      {kind === 'bedrock' && <div className="export-note">{t('export.bedrockNote')}</div>}
      {picking && (
        <AttachWindow
          initial={include}
          onClose={() => setPicking(false)}
          onApply={(ids) => {
            setInclude(ids)
            setPicking(false)
          }}
        />
      )}
    </Modal>
  )
}

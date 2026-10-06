import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { emoteToEmotecraft } from '../../pose/emote'
import { pickEmoteFiles, readEmoteFiles, squareLogo, usePoseLibrary } from '../../pose/library'
import { BUILTIN_ANIMS } from '../../pose/presets'
import { storage } from '../../lib/storage'
import { Icon } from '../common/Icon'
import { confirmBox, Modal, promptBox, toast } from '../common/dialogs'
import { EmotePreview } from '../pose/EmotePreview'
import type { Emote } from '../../pose/emote'
import { canRedistribute, defaultRights, type Rights } from '../../skin/rights'
import { RightsBadges, RightsEditor } from '../common/RightsEditor'
import { EmoteImportDialog } from '../pose/EmoteImportDialog'

/** Change an emote's name and rights later. */
function RightsOnlyDialog({ e, onClose, onSave }: { e: Emote; onClose: () => void; onSave: (name: string, r: Rights) => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(e.name)
  const [rights, setRights] = useState<Rights>(e.rights ?? defaultRights())
  return (
    <Modal title={t('rights.edit')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={() => onSave(name.trim() || e.name, rights)}>{t('common.save')}</button></>}>
      <label className="field">
        <span className="label">{t('rights.name')}</span>
        <input className="input" value={name} onChange={(ev) => setName(ev.target.value)} />
      </label>
      <RightsEditor value={rights} onChange={setRights} />
    </Modal>
  )
}

/** Home tab: emotes for every skin (Emotecraft .json / .emotecraft), with a playing preview. */
export function EmoteLibraryTab() {
  const { t } = useTranslation()
  const lib = usePoseLibrary()
  const [sel, setSel] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [drag, setDrag] = useState(false)
  const [queue, setQueue] = useState<Emote[]>([])
  const [editRights, setEditRights] = useState<Emote | null>(null)
  useEffect(() => void lib.load(), [])

  const all = [...BUILTIN_ANIMS, ...lib.emotes]
  const emote = all.find((e) => e.id === sel) ?? lib.emotes[0] ?? BUILTIN_ANIMS[0]
  const title = (e: (typeof all)[number]) => (e.builtin ? t('pose.anims.' + e.name) : e.name)
  const shown = lib.emotes.filter((e) => !q.trim() || (e.name + ' ' + e.author).toLowerCase().includes(q.trim().toLowerCase()))

  const importFiles = async (files: File[]) => {
    const { emotes, failed } = await readEmoteFiles(files)
    if (emotes.length) setQueue((q) => [...q, ...emotes])
    if (failed.length) toast(t('pose.failed', { list: failed.join('; ') }))
  }

  return (
    <div
      className={'emote-tab' + (drag ? ' dragging' : '')}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        importFiles([...e.dataTransfer.files])
      }}
    >
      <div className="emote-tab-list">
        <div className="row">
          <input className="input grow" placeholder={t('pose.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn primary" onClick={async () => importFiles(await pickEmoteFiles())}><Icon name="plus" />{t('pose.import')}</button>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>{t('pose.libHelp')}</span>
        <span className="label">{t('pose.builtinAnims')}</span>
        <div className="pose-grid">
          {BUILTIN_ANIMS.map((e) => (
            <button key={e.id} className={'pose-chip' + (emote?.id === e.id ? ' on' : '')} onClick={() => setSel(e.id)}>{title(e)}</button>
          ))}
        </div>
        <span className="label">{t('pose.emotes')} · {lib.emotes.length}</span>
        {lib.emotes.length === 0 && <div className="empty small">{t('pose.emotesEmpty')}</div>}
        <div className="emote-cards">
          {shown.map((e) => (
            <button key={e.id} className={'emote-card' + (emote?.id === e.id ? ' on' : '')} onClick={() => setSel(e.id)} title={e.description}>
              {e.icon ? <img src={e.icon} alt="" /> : <span className="emote-ph big"><Icon name="play" size={22} /></span>}
              <b>{e.name}</b>
              <span className="muted">{[e.author, (e.endTick / 20).toFixed(1) + 's', e.loop ? '∞' : ''].filter(Boolean).join(' · ')}</span>
              <RightsBadges value={e.rights} />
            </button>
          ))}
        </div>
      </div>
      <div className="emote-tab-side">
        <EmotePreview emote={emote ?? null} spin={false} />
        {emote && (
          <div className="emote-info">
            <b>{title(emote)}</b>
            {emote.author && <span className="muted">{t('pose.by', { author: emote.author })}</span>}
            {emote.description && <span className="muted" style={{ fontSize: 12 }}>{emote.description}</span>}
            <span className="muted" style={{ fontSize: 12 }}>{(emote.endTick / 20).toFixed(2)} s · {emote.loop ? t('pose.loop') : t('pose.once')}</span>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {!emote.builtin && (
                <button
                  className="btn sm-btn"
                  title={t('pose.logoHint')}
                  onClick={async () => {
                    const f = await storage.openImage()
                    if (f) lib.updateEmote(emote.id, { icon: await squareLogo(f.dataUrl) })
                  }}
                >
                  <Icon name="image" size={13} />
                  {emote.icon ? t('pose.changeLogo') : t('pose.addLogo')}
                </button>
              )}
              {!emote.builtin && emote.icon && (
                <button className="btn sm-btn" onClick={() => lib.updateEmote(emote.id, { icon: undefined })}>{t('pose.removeLogo')}</button>
              )}
              {!emote.builtin && (
                <button
                  className="btn sm-btn"
                  onClick={async () => {
                    const name = (await promptBox(t('common.rename'), emote.name, t('common.ok'), t('common.cancel')))?.trim()
                    if (name) lib.updateEmote(emote.id, { name })
                  }}
                >
                  {t('common.rename')}
                </button>
              )}
              {!emote.builtin && (
                <button className="btn sm-btn" onClick={() => setEditRights(emote)}>{t('rights.edit')}</button>
              )}
              <button
                className="btn sm-btn"
                disabled={!emote.builtin && !canRedistribute(emote.rights)}
                title={!emote.builtin && !canRedistribute(emote.rights) ? t('rights.downloadBlocked') : ''}
                onClick={async () => {
                  const safe = title(emote).replace(/[^\w\- ]+/g, '').trim() || 'emote'
                  const path = await storage.saveFile(new TextEncoder().encode(emoteToEmotecraft(emote)), safe + '.json', 'json', 'Emotecraft emote')
                  if (path) toast(t('pose.exported', { path }))
                }}
              >
                <Icon name="download" size={13} />
                {t('pose.exportEmote')}
              </button>
              {!emote.builtin && (
                <button
                  className="btn sm-btn danger"
                  onClick={async () => {
                    if (await confirmBox(t('pose.deleteEmote', { name: emote.name }), t('common.delete'), t('common.cancel'), true)) {
                      lib.removeEmote(emote.id)
                      setSel(null)
                    }
                  }}
                >
                  <Icon name="trash" size={13} />
                  {t('common.delete')}
                </button>
              )}
            </div>
            {!emote.builtin && <RightsBadges value={emote.rights} />}
            {!emote.builtin && !canRedistribute(emote.rights) && <span className="muted" style={{ fontSize: 11 }}>{t('rights.downloadBlocked')}</span>}
            <span className="muted" style={{ fontSize: 11 }}>{t('pose.useInSkin')}</span>
          </div>
        )}
      </div>
      {queue[0] && (
        <EmoteImportDialog
          key={queue[0].id}
          queue={queue}
          onClose={() => setQueue([])}
          onAdd={(list) => {
            if (list.length) {
              lib.addEmotes(list)
              setSel(list[0].id)
              toast(t('pose.imported', { n: list.length }))
            }
            setQueue((q) => q.slice(Math.max(1, list.length)))
          }}
        />
      )}
      {editRights && (
        <RightsOnlyDialog
          e={editRights}
          onClose={() => setEditRights(null)}
          onSave={(name, rights) => {
            lib.updateEmote(editRights.id, { name, rights })
            setEditRights(null)
          }}
        />
      )}
    </div>
  )
}

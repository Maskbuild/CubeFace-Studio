import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { storage, type AvatarMeta } from '../../lib/storage'
import { buildAvatar } from '../../figura/avatar'
import { confirmBox, promptBox, toast } from '../common/dialogs'
import { Icon } from '../common/Icon'
import { avatarMeta } from './FiguraPanel'
import { AvatarViewer } from './AvatarViewer'

const kb = (n: number) => (n / 1024).toFixed(1) + ' KB'
const desktopOnly = !window.nkw

function useAvatars() {
  const [list, setList] = useState<AvatarMeta[] | null>(null)
  const reload = () => storage.listAvatars().then(setList)
  useEffect(() => {
    reload()
  }, [])
  return { list, reload }
}

function AvatarCard({ a, selected, onClick, onDelete, onRename, onView }: { a: AvatarMeta; selected?: boolean; onClick?: () => void; onDelete: () => void; onRename: (name: string) => void; onView: () => void }) {
  const { t, i18n } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)
  const show = () => {
    const r = ref.current!.getBoundingClientRect()
    setTip({ x: Math.min(r.right + 8, window.innerWidth - 260), y: Math.max(8, Math.min(r.top, window.innerHeight - 220)) })
  }
  return (
    <div ref={ref} className={'item-card' + (selected ? ' on' : '')} onClick={onClick ?? onView} onDoubleClick={onView} onMouseEnter={show} onMouseLeave={() => setTip(null)}>
      {a.thumb ? <img src={a.thumb} alt="" className="avatar-thumb" draggable={false} /> : <div className="avatar-thumb empty-thumb"><Icon name="sparkle" size={28} /></div>}
      <div className="item-name" title={a.name}>{a.name}</div>
      <div className="item-res">{a.files} files · {kb(a.bytes)}</div>
      {selected && <span className="item-check"><Icon name="check" size={12} stroke={3} /></span>}
      <div className="item-actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn sm" title={t('avatars.view')} onClick={onView}><Icon name="eye" size={13} /></button>
        <button
          className="icon-btn sm"
          title={t('common.rename')}
          onClick={async () => {
            const name = (await promptBox(t('common.rename'), a.name, t('common.ok'), t('common.cancel')))?.trim()
            if (name) onRename(name)
          }}
        >
          <Icon name="edit" size={13} />
        </button>
        <button className="icon-btn sm" title={t('common.delete')} onClick={onDelete}><Icon name="trash" size={13} /></button>
      </div>
      {tip && (
        <div className="item-tip" style={{ left: tip.x, top: tip.y }}>
          <b>{a.name}</b>
          <dl>
            <dt>{t('figura.author')}</dt><dd>{a.authors.join(', ') || t('common.none')}</dd>
            <dt>{t('figura.description')}</dt><dd>{a.description || t('common.none')}</dd>
            <dt>{t('avatars.files')}</dt><dd>{a.files} · {kb(a.bytes)}</dd>
            <dt>{t('avatars.added')}</dt><dd>{new Date(a.importedAt).toLocaleString(i18n.language === 'th' ? 'th-TH' : 'en-GB')}</dd>
          </dl>
        </div>
      )}
    </div>
  )
}

/** Grid of library avatars with import (button or dropped folders), rename and delete. */
export function AvatarLibrary({ selected, onToggle, list, reload }: { selected?: Set<string>; onToggle?: (id: string) => void; list: AvatarMeta[] | null; reload: () => void }) {
  const { t } = useTranslation()
  const [over, setOver] = useState(false)
  const [viewing, setViewing] = useState<AvatarMeta | null>(null)

  const report = (r: { added: AvatarMeta[]; failed: string[] } | null) => {
    if (!r) return
    if (r.failed.length) toast(t('avatars.notAvatar', { names: r.failed.join(', ') }))
    else if (r.added.length) toast(t('avatars.imported', { n: r.added.length }))
    reload()
  }

  if (desktopOnly) return <div className="muted" style={{ padding: 20 }}>{t('avatars.desktopOnly')}</div>
  return (
    <div
      className={'wardrobe-lib drop-zone' + (over ? ' over' : '')}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={async (e) => {
        e.preventDefault()
        setOver(false)
        const paths = [...e.dataTransfer.files].map((f) => storage.pathForFile?.(f) ?? '').filter(Boolean)
        if (paths.length) report(await storage.importAvatars(paths))
      }}
    >
      {viewing && <AvatarViewer avatar={viewing} onClose={() => setViewing(null)} />}
      {over && <div className="drop-hint"><Icon name="sparkle" size={28} />{t('avatars.dropHere')}</div>}
      <div className="row">
        <span className="muted" style={{ fontSize: 12 }}>{t('avatars.hint')}</span>
        <div className="grow" />
        <button className="btn" onClick={async () => report(await storage.importAvatars())}><Icon name="plus" />{t('avatars.add')}</button>
      </div>
      {list && list.length === 0 && <div className="empty" style={{ padding: '30px 0' }}>{t('avatars.empty')}</div>}
      <div className="item-grid">
        {list?.map((a) => (
          <AvatarCard
            key={a.id}
            a={a}
            selected={selected?.has(a.id)}
            onClick={onToggle && (() => onToggle(a.id))}
            onView={() => setViewing(a)}
            onRename={async (name) => {
              await storage.updateAvatar(a.id, { name })
              reload()
            }}
            onDelete={async () => {
              if (!(await confirmBox(t('avatars.confirmDelete', { name: a.name }), t('common.delete'), t('common.cancel'), true))) return
              await storage.deleteAvatar(a.id)
              reload()
            }}
          />
        ))}
      </div>
    </div>
  )
}

/** Home tab: manage the library. */
export function AvatarLibraryTab() {
  const { list, reload } = useAvatars()
  return <AvatarLibrary list={list} reload={reload} />
}

/** Merge window: pick avatars (and optionally this skin's own avatar) like picking clothes. */
export function MergeWindow({ doc, onClose }: { doc: SkinDoc; onClose: () => void }) {
  const { t } = useTranslation()
  const { list, reload } = useAvatars()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [withCurrent, setWithCurrent] = useState(true)
  const [name, setName] = useState('Merged avatar')
  const count = sel.size + (withCurrent ? 1 : 0)

  const merge = async () => {
    const current = withCurrent ? { name: avatarMeta(doc).name, files: (await buildAvatar(doc, avatarMeta(doc))).files } : null
    // keep the user's pick order
    const ids = (list ?? []).filter((a) => sel.has(a.id)).map((a) => a.id)
    const r = await storage.mergeAvatars(ids, current, name)
    if (!r) return
    toast(t('figura.merged', { n: r.count, dir: r.out, r: r.renamed.length ? r.renamed.map((x) => `${x.from} → ${x.to}`).join(', ') : t('figura.none') }))
    onClose()
  }

  return (
    <div className="modal-back">
      <div className="wardrobe" style={{ gridTemplateRows: 'auto 1fr auto' }}>
        <header className="wardrobe-head">
          <Icon name="merge" size={18} />
          <b>{t('avatars.mergeTitle')}</b>
          <div className="grow" />
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="wardrobe-right" style={{ padding: 16 }}>
          <label className="row merge-current">
            <input type="checkbox" checked={withCurrent} onChange={(e) => setWithCurrent(e.target.checked)} />
            <span>{t('avatars.includeCurrent', { name: avatarMeta(doc).name })}</span>
          </label>
          <AvatarLibrary
            list={list}
            reload={reload}
            selected={sel}
            onToggle={(id) => setSel((s) => {
              const n = new Set(s)
              if (n.has(id)) n.delete(id)
              else n.add(id)
              return n
            })}
          />
        </div>
        <footer className="wardrobe-foot">
          <input className="input" style={{ width: 220 }} value={name} onChange={(e) => setName(e.target.value)} />
          <span className="muted" style={{ fontSize: 12 }}>{t('avatars.mergeHint', { n: count })}</span>
          <div className="grow" />
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={count < 2} onClick={merge}><Icon name="merge" />{t('avatars.merge')}</button>
        </footer>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { storage, type AvatarMeta } from '../../lib/storage'
import { renderAvatarThumb } from '../../lib/avatarModels'
import { confirmBox, promptBox, toast } from '../common/dialogs'
import { ContextMenu, type MenuItem } from '../common/ContextMenu'
import { Icon } from '../common/Icon'
import { AvatarViewer } from './AvatarViewer'
import { RightsBadges, RightsEditor } from '../common/RightsEditor'
import { defaultRights, type Rights } from '../../skin/rights'
import { Modal } from '../common/dialogs'
import { HoverTip } from '../common/HoverTip'

const kb = (n: number) => (n / 1024).toFixed(1) + ' KB'
const desktopOnly = !window.nkw
const CAT_KEY = 'avatarCategories'
type Meta = AvatarMeta & { noModel?: boolean }

/** Library list + user categories; 3D thumbnails are rendered one by one after import. */
function useAvatars() {
  const [list, setList] = useState<Meta[] | null>(null)
  const [cats, setCats] = useState<string[]>([])
  const busy = useRef(false)
  const reload = () => storage.listAvatars().then(setList)
  useEffect(() => {
    reload()
    storage.getGlobal<string[]>(CAT_KEY).then((c) => setCats(c ?? []))
  }, [])
  useEffect(() => {
    if (!list || busy.current) return
    const todo = list.find((a) => !a.thumb3d && !a.noModel)
    if (!todo) return
    busy.current = true
    const done = (url: string | null) => setList((l) => l && l.map((a) => (a.id === todo.id ? { ...a, thumb3d: url ?? undefined, noModel: !url } : a)))
    renderAvatarThumb(todo)
      .then(async (url) => {
        if (url) await storage.updateAvatar(todo.id, { thumb3d: url })
        done(url)
      })
      .catch(() => done(null))
      .finally(() => (busy.current = false))
  }, [list])
  const saveCats = (c: string[]) => {
    setCats(c)
    storage.setGlobal(CAT_KEY, c)
  }
  return { list, reload, cats, saveCats }
}

function AvatarCard({ a, selected, onClick, onView, onMenu }: { a: Meta; selected?: boolean; onClick?: () => void; onView: () => void; onMenu: (e: React.MouseEvent) => void }) {
  const { t, i18n } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<DOMRect | null>(null)
  const show = () => setTip(ref.current!.getBoundingClientRect())
  const thumb = a.thumb3d ?? a.thumb
  return (
    <div ref={ref} className={'item-card' + (selected ? ' on' : '')} onClick={onClick ?? onView} onDoubleClick={onView} onContextMenu={onMenu} onMouseEnter={show} onMouseLeave={() => setTip(null)}>
      {thumb ? <img src={thumb} alt="" className={'avatar-thumb' + (a.thumb3d ? ' rendered' : '')} draggable={false} /> : <div className="avatar-thumb empty-thumb"><Icon name="sparkle" size={28} /></div>}
      <div className="item-name" title={a.name}>{a.name}</div>
      <div className="item-res">{a.category || t('avatars.noCategory')} · {kb(a.bytes)}</div>
      <RightsBadges value={a.rights} />
      {selected && <span className="item-check"><Icon name="check" size={12} stroke={3} /></span>}
      <div className="item-actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn sm" title={t('avatars.view')} onClick={onView}><Icon name="eye" size={13} /></button>
        <button className="icon-btn sm" title={t('avatars.more')} onClick={onMenu}><Icon name="settings" size={13} /></button>
      </div>
      {tip && (
        <HoverTip anchor={tip}>
          <b>{a.name}</b>
          <dl>
            <dt>{t('figura.author')}</dt><dd>{a.authors.join(', ') || t('common.none')}</dd>
            <dt>{t('figura.description')}</dt><dd>{a.description || t('common.none')}</dd>
            <dt>{t('avatars.category')}</dt><dd>{a.category || t('avatars.noCategory')}</dd>
            <dt>{t('avatars.files')}</dt><dd>{a.files} · {kb(a.bytes)}</dd>
            <dt>{t('rights.title')}</dt><dd>{a.rights ? rightsText(t, a.rights) : t('rights.unset')}</dd>
            <dt>{t('avatars.added')}</dt><dd>{new Date(a.importedAt).toLocaleString(i18n.language === 'th' ? 'th-TH' : 'en-GB')}</dd>
          </dl>
        </HoverTip>
      )}
    </div>
  )
}

/**
 * Library grid: import (button or dropped folders), user-made categories, view, rename, delete.
 * With `selected`/`onToggle` cards become selectable (attach and merge windows).
 */
export function AvatarLibrary({ selected, onToggle }: { selected?: Set<string>; onToggle?: (id: string) => void }) {
  const { t } = useTranslation()
  const { list, reload, cats, saveCats } = useAvatars()
  const [over, setOver] = useState(false)
  const [cat, setCat] = useState<string | null>(null) // null = all
  const [viewing, setViewing] = useState<AvatarMeta | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)

  const [rightsQueue, setRightsQueue] = useState<AvatarMeta[]>([])
  const report = async (r: { added: AvatarMeta[]; failed: string[] } | null) => {
    if (!r) return
    if (r.failed.length) toast(t('avatars.notAvatar', { names: r.failed.join(', ') }))
    else if (r.added.length) toast(t('avatars.imported', { n: r.added.length }))
    // new imports land in the category being viewed
    if (cat) await Promise.all(r.added.map((a) => storage.updateAvatar(a.id, { category: cat })))
    // then ask where each one came from and what may be done with it
    if (r.added.length) setRightsQueue(r.added)
    reload()
  }
  const askCategory = (initial = '') => promptBox(t('avatars.newCategory'), initial, t('common.ok'), t('common.cancel')).then((s) => s?.trim() || null)
  const setCategory = async (a: AvatarMeta, c: string) => {
    await storage.updateAvatar(a.id, { category: c })
    reload()
  }
  const addCategory = async () => {
    const name = await askCategory()
    if (name && !cats.includes(name)) saveCats([...cats, name])
  }
  const catMenu = (e: React.MouseEvent, c: string) => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: t('common.rename'),
          icon: 'edit',
          onClick: async () => {
            const name = await askCategory(c)
            if (!name || name === c) return
            saveCats(cats.map((x) => (x === c ? name : x)))
            await Promise.all((list ?? []).filter((a) => a.category === c).map((a) => storage.updateAvatar(a.id, { category: name })))
            if (cat === c) setCat(name)
            reload()
          }
        },
        {
          label: t('avatars.deleteCategory'),
          icon: 'trash',
          danger: true,
          onClick: async () => {
            saveCats(cats.filter((x) => x !== c))
            await Promise.all((list ?? []).filter((a) => a.category === c).map((a) => storage.updateAvatar(a.id, { category: '' })))
            if (cat === c) setCat(null)
            reload()
          }
        }
      ]
    })
  }
  const cardMenu = (e: React.MouseEvent, a: AvatarMeta) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('avatars.view'), icon: 'eye', onClick: () => setViewing(a) },
        { label: t('rights.edit'), icon: 'info', onClick: () => setRightsQueue([a]) },
        {
          label: t('common.rename'),
          icon: 'edit',
          onClick: async () => {
            const name = (await promptBox(t('common.rename'), a.name, t('common.ok'), t('common.cancel')))?.trim()
            if (name) await storage.updateAvatar(a.id, { name })
            reload()
          }
        },
        'sep',
        { label: t('avatars.noCategory'), icon: a.category ? undefined : 'check', onClick: () => setCategory(a, '') },
        ...cats.map((c): MenuItem => ({ label: c, icon: a.category === c ? 'check' : undefined, onClick: () => setCategory(a, c) })),
        {
          label: t('avatars.newCategory'),
          icon: 'plus',
          onClick: async () => {
            const name = await askCategory()
            if (!name) return
            if (!cats.includes(name)) saveCats([...cats, name])
            setCategory(a, name)
          }
        },
        'sep',
        {
          label: t('common.delete'),
          icon: 'trash',
          danger: true,
          onClick: async () => {
            if (!(await confirmBox(t('avatars.confirmDelete', { name: a.name }), t('common.delete'), t('common.cancel'), true))) return
            await storage.deleteAvatar(a.id)
            reload()
          }
        }
      ]
    })
  }

  if (desktopOnly) return <div className="muted" style={{ padding: 20 }}>{t('avatars.desktopOnly')}</div>
  const shown = (list ?? []).filter((a) => cat === null || (a.category ?? '') === cat)
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
      {over && <div className="drop-hint"><Icon name="sparkle" size={28} />{t('avatars.dropHere')}</div>}
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          <button className={cat === null ? 'on' : ''} onClick={() => setCat(null)}>{t('wardrobe.all')}</button>
          {cats.map((c) => (
            <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)} onContextMenu={(e) => catMenu(e, c)} title={t('avatars.categoryHint')}>{c}</button>
          ))}
        </div>
        <button className="icon-btn sm" title={t('avatars.newCategory')} onClick={addCategory}><Icon name="plus" size={14} /></button>
        <div className="grow" />
        <button className="btn" onClick={async () => report(await storage.importAvatars())}><Icon name="plus" />{t('avatars.add')}</button>
        <button className="btn" onClick={async () => report(await storage.importAvatars(undefined, true))}><Icon name="download" />{t('avatars.addArchive')}</button>
      </div>
      <span className="muted" style={{ fontSize: 12 }}>{t('avatars.hint')}</span>
      {list && shown.length === 0 && <div className="empty" style={{ padding: '30px 0' }}>{t('avatars.empty')}</div>}
      <div className="item-grid">
        {shown.map((a) => (
          <AvatarCard key={a.id} a={a} selected={selected?.has(a.id)} onClick={onToggle && (() => onToggle(a.id))} onView={() => setViewing(a)} onMenu={(e) => cardMenu(e, a)} />
        ))}
      </div>
      {viewing && <AvatarViewer avatar={viewing} onClose={() => setViewing(null)} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {rightsQueue[0] && (
        <AvatarRightsDialog
          key={rightsQueue[0].id}
          a={rightsQueue[0]}
          left={rightsQueue.length - 1}
          onDone={async (patch, all) => {
            const targets = all ? rightsQueue : [rightsQueue[0]]
            await Promise.all(targets.map((x, i) => storage.updateAvatar(x.id, i === 0 ? patch : { rights: patch.rights })))
            setRightsQueue(all ? [] : rightsQueue.slice(1))
            reload()
          }}
          onSkip={() => setRightsQueue(rightsQueue.slice(1))}
        />
      )}
    </div>
  )
}

/** One-line summary of rights for tooltips. */
function rightsText(t: (k: string) => string, r: Rights) {
  if (r.source === 'own' || r.source === 'exclusive') return t('rights.src_' + r.source)
  return [t('rights.src_' + r.source), r.commercial ? t('rights.commercialShort') : t('rights.noCommercialShort'), r.redistribute ? t('rights.redistShort') : t('rights.noRedistShort'), t('rights.mod_' + r.modify)].join(' · ')
}

/** After importing: name and rights for each avatar (one at a time, or the same for all). */
function AvatarRightsDialog({ a, left, onDone, onSkip }: { a: AvatarMeta; left: number; onDone: (patch: { name: string; rights: Rights }, all: boolean) => void; onSkip: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(a.name)
  const [rights, setRights] = useState<Rights>(a.rights ?? defaultRights())
  const [all, setAll] = useState(false)
  return (
    <Modal
      title={t('rights.avatarTitle')}
      onClose={onSkip}
      footer={
        <>
          {left > 0 && (
            <label className="row" style={{ fontSize: 12, marginRight: 'auto' }}>
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
              {t('rights.applyAll', { n: left + 1 })}
            </label>
          )}
          <button className="btn" onClick={onSkip}>{t('rights.later')}</button>
          <button className="btn primary" onClick={() => onDone({ name: name.trim() || a.name, rights }, all)}>{t('common.save')}</button>
        </>
      }
    >
      <div className="row" style={{ gap: 12 }}>
        {(a.thumb3d ?? a.thumb) && <img src={a.thumb3d ?? a.thumb!} alt="" style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 8 }} className="checker" />}
        <label className="field grow">
          <span className="label">{t('rights.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          <span className="muted" style={{ fontSize: 11 }}>{a.authors.join(', ')}</span>
        </label>
      </div>
      <RightsEditor value={rights} onChange={setRights} />
    </Modal>
  )
}

/** Home tab: manage the library. */
export function AvatarLibraryTab() {
  return <AvatarLibrary />
}

/** Wardrobe-style picker: choose library avatars to use with the open skin. */
export function AttachWindow({ initial, onClose, onApply }: { initial: string[]; onClose: () => void; onApply: (ids: string[]) => void }) {
  const { t } = useTranslation()
  const [sel, setSel] = useState<string[]>(initial)
  return (
    <div className="modal-back">
      <div className="wardrobe" style={{ gridTemplateRows: 'auto 1fr auto' }}>
        <header className="wardrobe-head">
          <Icon name="sparkle" size={18} />
          <b>{t('figura.addFigura')}</b>
          <div className="grow" />
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="wardrobe-right" style={{ padding: 16 }}>
          <AvatarLibrary selected={new Set(sel)} onToggle={(id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
        </div>
        <footer className="wardrobe-foot">
          <span className="muted" style={{ fontSize: 12 }}>{t('figura.attachHint', { n: sel.length })}</span>
          <div className="grow" />
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={() => onApply(sel)}>{t('wardrobe.apply')}</button>
        </footer>
      </div>
    </div>
  )
}

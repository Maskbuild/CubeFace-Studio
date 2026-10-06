import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { storage, type SkinEntry } from '../../lib/storage'
import { createDoc, decodeSkin, loadDoc, saveDoc } from '../../lib/project'
import { SkinDoc } from '../../skin/doc'
import { useEditor } from '../../store/editor'
import { confirmBox, toast } from '../common/dialogs'
import { Icon } from '../common/Icon'
import { NewSkinDialog } from './NewSkinDialog'
import { SettingsDialog } from './SettingsDialog'
import { PaletteManager } from './PaletteManager'
import { readDroppedImages } from '../../lib/files'
import { useLibrary, WardrobeLibrary, WardrobeWindow } from '../wardrobe/Wardrobe'
import { AvatarLibraryTab } from '../figura/AvatarLibrary'
import { EmoteLibraryTab } from './EmoteLibrary'

type Tab = 'skins' | 'palettes' | 'emotes' | 'wardrobe' | 'avatars'

function WardrobeTab() {
  const lib = useLibrary()
  return <WardrobeLibrary items={lib.items} update={lib.update} />
}

export function Home() {
  const { t, i18n } = useTranslation()
  const setDoc = useEditor((s) => s.setDoc)
  const [tab, setTab] = useState<Tab>('skins')
  const [skins, setSkins] = useState<SkinEntry[] | null>(null)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<'new' | 'settings' | 'wardrobe' | null>(null)

  const refresh = () => storage.listSkins().then((l) => setSkins(l.sort((a, b) => b.project.updatedAt - a.project.updatedAt)))
  useEffect(() => {
    refresh()
  }, [])

  const shown = useMemo(() => (skins ?? []).filter((s) => s.project.name.toLowerCase().includes(query.toLowerCase())), [skins, query])

  const open = async (id: string) => {
    const doc = await loadDoc(id)
    if (doc) setDoc(doc)
  }

  const importPng = async () => {
    const file = await storage.openImage()
    if (file) importFile(file)
  }

  const importFile = async (file: { name: string; dataUrl: string }) => {
    const r = await decodeSkin(file.dataUrl)
    if (!r.ok) return toast(t('home.badSize', { w: r.w, h: r.h }))
    if (r.legacy) toast(t('home.legacyUpgraded'))
    const doc = new SkinDoc({ name: file.name, res: r.img.w, variant: r.variant })
    doc.initLayers([doc.makeLayer(t('layers.base'), r.img)])
    await saveDoc(doc)
    setDoc(doc)
  }

  const duplicate = async (id: string) => {
    const src = await loadDoc(id)
    if (!src) return
    const copy = new SkinDoc({ name: src.name + ' copy', res: src.res, variant: src.variant })
    copy.initLayers(src.layers.map((l) => ({ ...l })), src.activeId)
    copy.initHair(src.hair)
    copy.initFigura(src.figura, src.faces)
    await saveDoc(copy)
    refresh()
  }

  const remove = async (e: SkinEntry) => {
    if (!(await confirmBox(t('home.confirmDelete', { name: e.project.name }), t('common.delete'), t('common.cancel'), true))) return
    await storage.deleteSkin(e.project.id)
    refresh()
  }

  const fmt = new Intl.DateTimeFormat(i18n.language === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="home">
      <div className="home-head">
        <div className="brand">
          <b>{t('app.title')}</b>
          <span>{t('app.subtitle')}</span>
        </div>
        <div className="grow" />
        {tab === 'skins' && (
          <>
            <div className="row" style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 9, top: 7, color: 'var(--text-3)' }}><Icon name="search" size={15} /></span>
              <input className="input" style={{ paddingLeft: 30, width: 220 }} placeholder={t('home.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <button className="btn" onClick={importPng}><Icon name="image" />{t('home.importPng')}</button>
            <button className="btn" onClick={() => setDialog('wardrobe')}><Icon name="shirt" />{t('wardrobe.createFrom')}</button>
            <button className="btn primary" onClick={() => setDialog('new')}><Icon name="plus" />{t('home.newSkin')}</button>
          </>
        )}
        <button className="icon-btn" title={t('settings.title')} onClick={() => setDialog('settings')}><Icon name="settings" size={18} /></button>
      </div>

      <nav className="home-tabs">
        <button className={tab === 'skins' ? 'on' : ''} onClick={() => setTab('skins')}>{t('home.tabSkins')}</button>
        <button className={tab === 'palettes' ? 'on' : ''} onClick={() => setTab('palettes')}>{t('home.tabPalettes')}</button>
        <button className={tab === 'wardrobe' ? 'on' : ''} onClick={() => setTab('wardrobe')}>{t('home.tabWardrobe')}</button>
        <button className={tab === 'avatars' ? 'on' : ''} onClick={() => setTab('avatars')}>{t('home.tabAvatars')}</button>
        <button className={tab === 'emotes' ? 'on' : ''} onClick={() => setTab('emotes')}>{t('home.tabEmotes')}</button>
      </nav>

      <div
        className="home-body"
        onDragOver={(e) => tab === 'skins' && [...e.dataTransfer.types].includes('Files') && e.preventDefault()}
        onDrop={async (e) => {
          if (tab !== 'skins') return
          e.preventDefault()
          const [first] = await readDroppedImages(e.dataTransfer.files)
          if (first) importFile(first)
        }}
      >
        {tab === 'palettes' && <PaletteManager />}
        {tab === 'wardrobe' && <WardrobeTab />}
        {tab === 'avatars' && <AvatarLibraryTab />}
        {tab === 'emotes' && <EmoteLibraryTab />}
        {tab === 'skins' && skins && shown.length === 0 && <div className="empty">{t('home.empty')}</div>}
        {tab === 'skins' && (
          <div className="skin-grid">
            {shown.map((e) => (
              <div key={e.project.id} className="skin-card" onClick={() => open(e.project.id)}>
                <div className="thumb">{e.thumb && <img src={e.thumb} alt="" draggable={false} />}</div>
                <div className="meta">
                  <div className="name" title={e.project.name}>{e.project.name}</div>
                  <div className="tags">
                    <span className="tag">{e.project.res}×{e.project.res}</span>
                    <span className="tag">{e.project.variant === 'slim' ? 'Slim' : 'Wide'}</span>
                    <span className="tag">{e.project.layers.length} L</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{t('home.updated', { date: fmt.format(e.project.updatedAt) })}</div>
                </div>
                <div className="actions" onClick={(ev) => ev.stopPropagation()}>
                  <button className="icon-btn sm" title={t('common.duplicate')} onClick={() => duplicate(e.project.id)}><Icon name="copy" size={14} /></button>
                  <button className="icon-btn sm" title={t('common.delete')} onClick={() => remove(e)}><Icon name="trash" size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {dialog === 'new' && (
        <NewSkinDialog
          onClose={() => setDialog(null)}
          onCreate={async (o) => {
            const doc = createDoc(o.name, o.res, o.variant, o.template, t('layers.base'))
            await saveDoc(doc)
            setDoc(doc)
          }}
        />
      )}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'wardrobe' && (
        <WardrobeWindow
          onClose={() => setDialog(null)}
          onCreate={async (doc) => {
            await saveDoc(doc)
            setDoc(doc)
          }}
        />
      )}
    </div>
  )
}

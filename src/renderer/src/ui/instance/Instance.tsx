import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { exportFileName, saveDoc } from '../../lib/project'
import { imgToDataUrl } from '../../lib/png'
import { storage } from '../../lib/storage'
import { useEditor } from '../../store/editor'
import { ask, toast } from '../common/dialogs'
import { Icon } from '../common/Icon'
import { UVPanel } from './UVPanel'
import { LayerPanel } from './LayerPanel'
import { Viewport } from './Viewport'
import { RightPanel } from './RightPanel'
import { ShortcutsDialog } from '../common/ShortcutsDialog'
import { ExportDialog } from './ExportDialog'
import { bindShortcuts } from '../../lib/shortcuts'
import { pasteLayer } from '../../lib/layerActions'
import { readDroppedImages } from '../../lib/files'
import { FacePanel } from '../figura/FacePanel'
import { FiguraPanel } from '../figura/FiguraPanel'
import { pasteFloating, pixelsCopiedLast } from '../../lib/selection'
import { PoseLibraryPanel } from '../pose/PoseLibraryPanel'
import { PosePanel } from '../pose/PosePanel'


export function Instance({ doc }: { doc: SkinDoc }) {
  const { t } = useTranslation()
  const { setDoc, bump, mode, set } = useEditor()
  const switchMode = (m: 'skin' | 'figura' | 'pose') => {
    if (m !== 'figura') doc.selectFace(null)
    set({ mode: m })
  }
  // draggable split between the UV panel and the panel below it (remembered per machine)
  const [uvHeight, setUvHeight] = useState(() => {
    try {
      return Number(localStorage.getItem('nkw.uvHeight')) || 360
    } catch {
      return 360
    }
  })
  const startSplit = (e: React.PointerEvent) => {
    const y0 = e.clientY
    const h0 = uvHeight
    const move = (ev: PointerEvent) => setUvHeight(Math.max(180, Math.min(window.innerHeight - 220, h0 + ev.clientY - y0)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setUvHeight((h) => {
        try {
          localStorage.setItem('nkw.uvHeight', String(h))
        } catch {
          // storage unavailable: the size just isn't remembered
        }
        return h
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  useEditor((s) => s.tick)
  const [name, setName] = useState(doc.name)

  const [help, setHelp] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportPng = () => storage.savePng(imgToDataUrl(doc.composite), exportFileName(doc.name))
  const save = async () => {
    await saveDoc(doc)
    toast(t('common.saved'))
  }

  const leave = async () => {
    if (doc.dirty) {
      const r = await ask(t('top.leaveUnsaved'), [
        { label: t('common.cancel'), value: 'cancel' },
        { label: t('common.discard'), value: 'discard', kind: 'danger' },
        { label: t('common.save'), value: 'save', kind: 'primary' }
      ])
      if (r === 'cancel' || r === null) return
      if (r === 'save') await saveDoc(doc)
    }
    setDoc(null)
  }

  useEffect(() => {
    const off = doc.on((e) => e.type === 'structure' && bump())
    const unbind = bindShortcuts(doc, {
      save,
      exportPng,
      help: () => setHelp(true),
      newLayerName: () => t('layers.defaultName', { n: doc.layers.length + 1 })
    })
    // Ctrl+V: images on the system clipboard become layers; otherwise paste the copied layer
    const onPaste = async (e: ClipboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return
      e.preventDefault()
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (!file && pixelsCopiedLast()) return void pasteFloating(doc)
      if (!file) return pasteLayer(doc)
      const [img] = await readDroppedImages([file])
      pasteLayer(doc, img)
    }
    window.addEventListener('paste', onPaste)
    // autosave every 60s when there are changes
    const timer = setInterval(() => doc.dirty && saveDoc(doc), 60000)
    return () => {
      off()
      unbind()
      window.removeEventListener('paste', onPaste)
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  return (
    <div className="instance">
      <header className="topbar">
        <button className="icon-btn" title={t('top.home')} onClick={leave}><Icon name="home" size={18} /></button>
        <input className="title-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && doc.rename(name.trim())} />
        {doc.dirty && <span className="dot" title={t('top.unsaved')} />}
        <span className="sep" />
        <button className="icon-btn" title={t('top.undo')} disabled={!doc.canUndo} onClick={() => doc.undo()}><Icon name="undo" /></button>
        <button className="icon-btn" title={t('top.redo')} disabled={!doc.canRedo} onClick={() => doc.redo()}><Icon name="redo" /></button>
        <button className="icon-btn" title={t('top.save')} onClick={save}><Icon name="save" /></button>
        <button className="btn ghost" onClick={() => setExporting(true)}><Icon name="download" />{t('export.button')}</button>
        <div className="grow" />
        <button className="icon-btn" title={t('keys.title') + ' (F1)'} onClick={() => setHelp(true)}><Icon name="keyboard" size={18} /></button>
        <div className="seg">
          <button className={mode === 'skin' ? 'on' : ''} onClick={() => switchMode('skin')}>{t('mode.skin')}</button>
          <button className={mode === 'figura' ? 'on' : ''} onClick={() => switchMode('figura')}>{t('mode.figura')}</button>
          <button className={mode === 'pose' ? 'on' : ''} onClick={() => switchMode('pose')}>{t('mode.pose')}</button>
        </div>
      </header>
      <div className="workspace">
        <aside className="side left">
          {mode === 'pose' ? (
            <PoseLibraryPanel />
          ) : (
            <>
              <div style={{ height: uvHeight, flex: 'none', display: 'flex', flexDirection: 'column' }}>
                <UVPanel doc={doc} />
              </div>
              <div className="splitter" onPointerDown={startSplit} title={t('ui.dragResize')} />
              {/* Skin and Figura are separate pages, switched with the top-right buttons */}
              {mode === 'skin' ? <LayerPanel doc={doc} /> : <FacePanel doc={doc} />}
            </>
          )}
        </aside>
        <Viewport doc={doc} />
        <aside className="side right">{mode === 'skin' ? <RightPanel doc={doc} /> : mode === 'figura' ? <FiguraPanel doc={doc} /> : <PosePanel />}</aside>
      </div>
      {help && <ShortcutsDialog onClose={() => setHelp(false)} />}
      {exporting && <ExportDialog doc={doc} onClose={() => setExporting(false)} />}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { exportFileName, saveDoc } from '../../lib/project'
import { imgToDataUrl } from '../../lib/png'
import { storage } from '../../lib/storage'
import { useEditor, type Tool } from '../../store/editor'
import { ask, toast } from '../common/dialogs'
import { Icon } from '../common/Icon'
import { UVPanel } from './UVPanel'
import { LayerPanel } from './LayerPanel'
import { Viewport } from './Viewport'
import { RightPanel } from './RightPanel'

const KEY_TOOLS: Record<string, Tool> = { b: 'brush', e: 'eraser', g: 'bucket', i: 'picker' }

export function Instance({ doc }: { doc: SkinDoc }) {
  const { t } = useTranslation()
  const { setDoc, bump } = useEditor()
  useEditor((s) => s.tick)
  const [name, setName] = useState(doc.name)

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
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return
      const k = e.key.toLowerCase()
      if (e.ctrlKey && k === 'z') (e.preventDefault(), e.shiftKey ? doc.redo() : doc.undo())
      else if (e.ctrlKey && k === 'y') (e.preventDefault(), doc.redo())
      else if (e.ctrlKey && k === 's') (e.preventDefault(), save())
      else if (!e.ctrlKey && KEY_TOOLS[k]) useEditor.getState().set({ tool: KEY_TOOLS[k] })
      else if (!e.ctrlKey && k === 'm') useEditor.getState().set({ mirror: !useEditor.getState().mirror })
      else if (k === '[' || k === ']') {
        const s = useEditor.getState()
        const b = s.tool === 'eraser' ? s.eraser : s.brush
        s.setBrush({ size: Math.max(1, b.size + (k === ']' ? 1 : -1)) })
      }
    }
    window.addEventListener('keydown', onKey)
    // autosave every 60s when there are changes
    const timer = setInterval(() => doc.dirty && saveDoc(doc), 60000)
    return () => {
      off()
      window.removeEventListener('keydown', onKey)
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
        <button className="btn ghost" onClick={() => storage.savePng(imgToDataUrl(doc.composite), exportFileName(doc.name))}><Icon name="download" />{t('top.exportPng')}</button>
        <div className="grow" />
        <div className="seg">
          <button className="on">{t('mode.skin')}</button>
          <button disabled title={t('common.comingSoon')}>{t('mode.figura')}</button>
          <button disabled title={t('common.comingSoon')}>{t('mode.pose')}</button>
        </div>
      </header>
      <div className="workspace">
        <aside className="side left">
          <UVPanel doc={doc} />
          <LayerPanel doc={doc} />
        </aside>
        <Viewport doc={doc} />
        <RightPanel doc={doc} />
      </div>
    </div>
  )
}

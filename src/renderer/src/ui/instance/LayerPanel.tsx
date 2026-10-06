import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isNoModify, type Layer, type License, type SkinDoc } from '../../skin/doc'
import { useEditor } from '../../store/editor'
import { Modal } from '../common/dialogs'
import { Icon } from '../common/Icon'
import { ContextMenu, type MenuItem } from '../common/ContextMenu'
import { copyLayer, exportLayer, importAsNewLayers, importIntoLayer, pasteLayer } from '../../lib/layerActions'
import { readDroppedImages } from '../../lib/files'

function LayerThumb({ layer, res }: { layer: Layer; res: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const tick = useEditor((s) => s.tick)
  useEffect(() => {
    const c = ref.current!
    c.width = c.height = 64
    const ctx = c.getContext('2d')!
    const tmp = document.createElement('canvas')
    tmp.width = tmp.height = res
    tmp.getContext('2d')!.putImageData(new ImageData(layer.img.data, res, res), 0, 0)
    ctx.clearRect(0, 0, 64, 64)
    ctx.imageSmoothingEnabled = res > 64
    ctx.drawImage(tmp, 0, 0, 64, 64)
  }, [layer, layer.img, res, tick])
  return <canvas ref={ref} className="lthumb checker" />
}

const LICENSES: License[] = ['free', 'commercial-nomod', 'commercial-mod', 'exclusive']

function LayerInfoDialog({ doc, layer, onClose }: { doc: SkinDoc; layer: Layer; onClose: () => void }) {
  const { t } = useTranslation()
  const [meta, setMeta] = useState(layer.meta)
  const [name, setName] = useState(layer.name)
  const save = () => {
    doc.setLayerProps(layer.id, { name: name.trim() || layer.name, meta })
    onClose()
  }
  return (
    <Modal
      title={t('layers.info')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={save}>{t('common.save')}</button>
        </>
      }
    >
      <label className="field">
        <span className="label">{t('newSkin.name')}</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">{t('layers.credit')}</span>
        <input className="input" value={meta.credit} placeholder={t('common.none')} onChange={(e) => setMeta({ ...meta, credit: e.target.value })} />
      </label>
      <label className="field">
        <span className="label">{t('layers.license')}</span>
        <select className="select" value={meta.license} onChange={(e) => setMeta({ ...meta, license: e.target.value as License })}>
          {LICENSES.map((l) => (
            <option key={l} value={l}>{t(`license.${l}`)}</option>
          ))}
        </select>
      </label>
      {meta.license === 'commercial-mod' && (
        <label className="field">
          <span className="label">{t('layers.modifyPercent')}: {meta.modifyPercent}%</span>
          <input type="range" min={0} max={100} value={meta.modifyPercent} onChange={(e) => setMeta({ ...meta, modifyPercent: Number(e.target.value) })} />
        </label>
      )}
    </Modal>
  )
}

export function LayerPanel({ doc }: { doc: SkinDoc }) {
  const { t } = useTranslation()
  useEditor((s) => s.tick)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string | null } | null>(null)
  const [fileOver, setFileOver] = useState(false)
  // F2 / menu "Rename" ask through the store
  const renameReq = useEditor((s) => s.renameLayerId)
  useEffect(() => {
    if (renameReq) {
      setRenaming(renameReq)
      useEditor.getState().set({ renameLayerId: null })
    }
  }, [renameReq])

  const menuItems = (id: string | null): MenuItem[] => {
    const l = id ? doc.layer(id) : undefined
    const i = l ? doc.layers.indexOf(l) : -1
    const items: MenuItem[] = [
      { label: t('layers.add'), icon: 'plus', shortcut: 'Ctrl+Shift+N', onClick: () => doc.addLayer(t('layers.defaultName', { n: doc.layers.length + 1 })) },
      { label: t('layers.importNew'), icon: 'image', onClick: () => importAsNewLayers(doc) },
      { label: t('layers.paste'), icon: 'copy', shortcut: 'Ctrl+V', disabled: !useEditor.getState().clipboard, onClick: () => pasteLayer(doc) }
    ]
    if (!l) return items
    return [
      ...items,
      'sep',
      { label: t('layers.importInto'), icon: 'image', disabled: l.locked, onClick: () => importIntoLayer(doc, l.id) },
      { label: t('layers.copy'), icon: 'copy', shortcut: 'Ctrl+C', onClick: () => copyLayer(doc) },
      { label: t('layers.duplicate'), icon: 'copy', shortcut: 'Ctrl+D', onClick: () => doc.duplicateLayer(l.id) },
      { label: t('common.rename'), icon: 'edit', shortcut: 'F2', onClick: () => setRenaming(l.id) },
      'sep',
      { label: t('layers.up'), icon: 'up', shortcut: 'Ctrl+↑', disabled: i >= doc.layers.length - 1, onClick: () => doc.moveLayer(l.id, 1) },
      { label: t('layers.down'), icon: 'down', shortcut: 'Ctrl+↓', disabled: i <= 0, onClick: () => doc.moveLayer(l.id, -1) },
      { label: t('layers.merge'), icon: 'merge', shortcut: 'Ctrl+E', disabled: i <= 0, onClick: () => doc.mergeDown(l.id) },
      'sep',
      { label: l.visible ? t('layers.hide') : t('layers.show'), icon: l.visible ? 'eyeOff' : 'eye', onClick: () => doc.setLayerProps(l.id, { visible: !l.visible }) },
      { label: l.locked ? t('layers.unlock') : t('layers.lock'), icon: l.locked ? 'unlock' : 'lock', onClick: () => doc.setLayerProps(l.id, { locked: !l.locked }) },
      { label: l.glow ? t('glow.off') : t('glow.on'), icon: 'sun', onClick: () => doc.setLayerProps(l.id, { glow: !l.glow }) },
      { label: t('layers.info'), icon: 'info', onClick: () => setInfo(l) },
      { label: t('layers.exportPng'), icon: 'download', onClick: () => exportLayer(doc, l.id) },
      'sep',
      { label: t('layers.clear'), icon: 'eraser', disabled: l.locked, onClick: () => doc.replaceLayerPixels(l.id, null) },
      { label: t('layers.remove'), icon: 'trash', shortcut: 'Del', danger: true, disabled: doc.layers.length <= 1, onClick: () => doc.removeLayer(l.id) }
    ]
  }
  const [info, setInfo] = useState<Layer | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; below: boolean } | null>(null)

  /** Drop the dragged layer above/below a row (rows are shown top layer first). */
  const finishDrop = () => {
    if (drag && drop && drag !== drop.id) {
      const order = [...doc.layers].reverse().map((l) => l.id).filter((id) => id !== drag)
      const p = order.indexOf(drop.id) + (drop.below ? 1 : 0)
      order.splice(p, 0, drag)
      doc.moveLayerTo(drag, order.length - 1 - p)
    }
    setDrag(null)
    setDrop(null)
  }
  const active = doc.active
  const idx = doc.layers.findIndex((l) => l.id === doc.activeId)

  return (
    <div
      className={'layers' + (fileOver ? ' file-over' : '')}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setFileOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setFileOver(false)}
      onDrop={async (e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setFileOver(false)
        importAsNewLayers(doc, await readDroppedImages(e.dataTransfer.files))
      }}
    >
      <div className="section" style={{ paddingBottom: 6, borderBottom: 0 }}>
        <div className="section-head">
          <span className="label">{t('layers.title')}</span>
          {active && (
            <label className="row muted" style={{ fontSize: 12, width: 150 }} title={t('layers.opacity')}>
              <input type="range" min={0} max={1} step={0.01} value={active.opacity} onChange={(e) => doc.setLayerProps(active.id, { opacity: Number(e.target.value) })} />
              <span style={{ width: 34, textAlign: 'right' }}>{Math.round(active.opacity * 100)}%</span>
            </label>
          )}
        </div>
      </div>
      <div
        className="layer-list"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, id: null })
        }}
      >
        {[...doc.layers].reverse().map((l) => (
          <div
            key={l.id}
            className={
              'layer' +
              (l.id === doc.activeId ? ' on' : '') +
              (l.visible ? '' : ' hidden-layer') +
              (drag === l.id ? ' dragging' : '') +
              (drop?.id === l.id && drag !== l.id ? (drop.below ? ' drop-below' : ' drop-above') : '')
            }
            draggable={renaming !== l.id}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', l.id)
              setDrag(l.id)
            }}
            onDragOver={(e) => {
              if (!drag) return
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect()
              const below = e.clientY > r.top + r.height / 2
              if (drop?.id !== l.id || drop.below !== below) setDrop({ id: l.id, below })
            }}
            onDrop={(e) => (e.preventDefault(), finishDrop())}
            onDragEnd={() => (setDrag(null), setDrop(null))}
            onClick={() => doc.setActive(l.id)}
            onDoubleClick={() => setRenaming(l.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              doc.setActive(l.id)
              setMenu({ x: e.clientX, y: e.clientY, id: l.id })
            }}
          >
            <button className="icon-btn sm" title={t('layers.visible')} onClick={(e) => (e.stopPropagation(), doc.setLayerProps(l.id, { visible: !l.visible }))}>
              <Icon name={l.visible ? 'eye' : 'eyeOff'} size={14} />
            </button>
            <LayerThumb layer={l} res={doc.res} />
            <div className="lname">
              {renaming === l.id ? (
                <input
                  className="input"
                  style={{ height: 24 }}
                  autoFocus
                  defaultValue={l.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    if (e.target.value.trim()) doc.setLayerProps(l.id, { name: e.target.value.trim() })
                    setRenaming(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <span title={l.meta.credit ? `${l.name} — ${l.meta.credit}` : l.name}>{l.name}</span>
              )}
            </div>
            {isNoModify(l.meta) && <span className="warn" title={t('license.commercial-nomod')}><Icon name="warn" size={14} /></span>}
            <button className={'icon-btn sm glow-btn' + (l.glow ? ' on' : '')} title={t('glow.toggle')} onClick={(e) => (e.stopPropagation(), doc.setLayerProps(l.id, { glow: !l.glow }))}>
              <Icon name="sun" size={14} />
            </button>
            <button className="icon-btn sm" title={t('layers.info')} onClick={(e) => (e.stopPropagation(), setInfo(l))}>
              <Icon name="info" size={14} />
            </button>
            <button className={'icon-btn sm' + (l.locked ? ' active' : '')} title={t('layers.lock')} onClick={(e) => (e.stopPropagation(), doc.setLayerProps(l.id, { locked: !l.locked }))}>
              <Icon name={l.locked ? 'lock' : 'unlock'} size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="layer-foot">
        <button className="icon-btn" title={t('layers.add')} onClick={() => doc.addLayer(t('layers.defaultName', { n: doc.layers.length + 1 }))}><Icon name="plus" /></button>
        <button className="icon-btn" title={t('layers.duplicate')} disabled={!active} onClick={() => active && doc.duplicateLayer(active.id)}><Icon name="copy" /></button>
        <button className="icon-btn" title={t('layers.up')} disabled={idx >= doc.layers.length - 1} onClick={() => doc.moveLayer(doc.activeId, 1)}><Icon name="up" /></button>
        <button className="icon-btn" title={t('layers.down')} disabled={idx <= 0} onClick={() => doc.moveLayer(doc.activeId, -1)}><Icon name="down" /></button>
        <button className="icon-btn" title={t('layers.merge')} disabled={idx <= 0} onClick={() => doc.mergeDown(doc.activeId)}><Icon name="merge" /></button>
        <div className="grow" />
        <button className="icon-btn" title={t('layers.remove')} disabled={doc.layers.length <= 1} onClick={() => doc.removeLayer(doc.activeId)}><Icon name="trash" /></button>
      </div>
      {info && <LayerInfoDialog doc={doc} layer={info} onClose={() => setInfo(null)} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={() => setMenu(null)} />}
      {fileOver && <div className="drop-hint"><Icon name="image" size={26} />{t('layers.dropHere')}</div>}
    </div>
  )
}

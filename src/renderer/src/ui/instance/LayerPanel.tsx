import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isNoModify, type Layer, type License, type SkinDoc } from '../../skin/doc'
import { useEditor } from '../../store/editor'
import { Modal } from '../common/dialogs'
import { Icon } from '../common/Icon'

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
  const [info, setInfo] = useState<Layer | null>(null)
  const active = doc.active
  const idx = doc.layers.findIndex((l) => l.id === doc.activeId)

  return (
    <div className="layers">
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
      <div className="layer-list">
        {[...doc.layers].reverse().map((l) => (
          <div
            key={l.id}
            className={'layer' + (l.id === doc.activeId ? ' on' : '') + (l.visible ? '' : ' hidden-layer')}
            onClick={() => doc.setActive(l.id)}
            onDoubleClick={() => setRenaming(l.id)}
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
    </div>
  )
}

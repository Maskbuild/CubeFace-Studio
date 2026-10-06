import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { DEFAULT_FLOW, LENGTH_PRESET, physFromFlow, type HairLength, type HairPlane, type HairSide } from '../../skin/hair'
import { MOTION_MODES, type MotionMode } from '../../three/motion'
import { useEditor } from '../../store/editor'
import { Icon } from '../common/Icon'

const SIDES: HairSide[] = ['front', 'back']
const LENGTHS: HairLength[] = ['short', 'medium', 'long']

function Num({ value, step = 0.25, min, max, onChange }: { value: number; step?: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <input
      className="input num"
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        const v = Number(e.target.value)
        if (e.target.value !== '' && Number.isFinite(v)) onChange(min !== undefined ? Math.max(min, max !== undefined ? Math.min(max, v) : v) : v)
      }}
    />
  )
}

function Vec3({ value, step, onChange }: { value: [number, number, number]; step?: number; onChange: (v: [number, number, number]) => void }) {
  return (
    <div className="vec3">
      {value.map((n, i) => (
        <Num key={i} value={n} step={step} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)) as [number, number, number])} />
      ))}
    </div>
  )
}

function PhysSlider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="phys-row">
      <span className="muted">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{Math.round(value * 100)}%</span>
    </label>
  )
}

function HairProps({ doc, h }: { doc: SkinDoc; h: HairPlane }) {
  const { t } = useTranslation()
  const up = (p: Partial<HairPlane>) => doc.updateHair(h.id, p)
  // older planes have no smoothness value yet: show their length's default
  const flow = h.phys.flow ?? DEFAULT_FLOW[h.length]
  return (
    <div className="hair-props">
      <input className="input" value={h.name} onChange={(e) => up({ name: e.target.value })} />
      <div className="prop-grid">
        <span className="muted">{t('hair.side')}</span>
        <div className="seg">
          {SIDES.map((s) => (
            <button
              key={s}
              className={h.side === s ? 'on' : ''}
              onClick={() => up({ side: s, pos: [h.pos[0], h.pos[1], s === 'front' ? Math.abs(h.pos[2]) : -Math.abs(h.pos[2])], rot: [h.rot[0], s === 'back' ? 180 : 0, h.rot[2]] })}
            >
              {t(`hair.${s}`)}
            </button>
          ))}
        </div>
        <span className="muted" title={t('hair.lengthApplies')}>{t('hair.length')}</span>
        <div className="seg">
          {LENGTHS.map((l) => (
            <button key={l} className={h.length === l ? 'on' : ''} title={t('hair.lengthApplies')} onClick={() => up({ length: l, h: LENGTH_PRESET[l].h, segments: LENGTH_PRESET[l].segments, phys: { ...LENGTH_PRESET[l].phys } })}>
              {t(`hair.${l}`)}
            </button>
          ))}
        </div>
        <span className="muted">{t('hair.width')}</span>
        <Num value={h.w} step={1} min={1} max={32} onChange={(v) => up({ w: v })} />
        <span className="muted">{t('hair.height')}</span>
        <Num value={h.h} step={1} min={1} max={48} onChange={(v) => up({ h: v })} />
        <span className="muted">{t('hair.segments')}</span>
        <Num value={h.segments} step={1} min={1} max={12} onChange={(v) => up({ segments: Math.round(v) })} />
      </div>
      <span className="muted">{t('hair.pos')}</span>
      <Vec3 value={h.pos} onChange={(v) => up({ pos: v })} />
      <span className="muted">{t('hair.rot')}</span>
      <Vec3 value={h.rot} step={5} onChange={(v) => up({ rot: v })} />
      <span className="label" style={{ marginTop: 4 }}>{t('hair.physics')}</span>
      {/* one setting: everything else is derived and always bounce-free */}
      <PhysSlider label={t('hair.flow')} value={flow} min={0} max={1} step={0.05} onChange={(v) => up({ phys: physFromFlow(v, h.length) })} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: 11 }}>{t('hair.flowHint')}</span>
        <button className="btn sm-btn" disabled={flow === DEFAULT_FLOW[h.length]} onClick={() => up({ phys: physFromFlow(DEFAULT_FLOW[h.length], h.length) })}>
          <Icon name="reset" size={12} />
          {t('hair.resetPhys')}
        </button>
      </div>
    </div>
  )
}

export function HairPanel({ doc, onOpenPresets }: { doc: SkinDoc; onOpenPresets: () => void }) {
  const { t } = useTranslation()
  useEditor((s) => s.tick)
  const { figura, motion, hairOutlines, set } = useEditor()
  const [side, setSide] = useState<HairSide>('back')
  const [length, setLength] = useState<HairLength>('medium')
  const sel = doc.hairPlane(doc.hairId)

  return (
    <div className="section">
      <div className="section-head">
        <span className="label">{t('hair.title')}</span>
        <div className="row" style={{ gap: 2 }}>
          <button className={'btn sm-btn' + (figura ? ' primary' : '')} title={t('hair.preview')} onClick={() => set({ figura: !figura })}>
            <Icon name="sparkle" size={14} />
            Preview
          </button>
          <button className="icon-btn sm" title={t('hair.presets')} onClick={onOpenPresets}>
            <Icon name="settings" size={14} />
          </button>
        </div>
      </div>

      <div className="row">
        <div className="seg grow">
          {SIDES.map((s) => (
            <button key={s} style={{ flex: 1 }} className={side === s ? 'on' : ''} onClick={() => setSide(s)}>{t(`hair.${s}`)}</button>
          ))}
        </div>
        <div className="seg grow">
          {LENGTHS.map((l) => (
            <button key={l} style={{ flex: 1, padding: '0 6px' }} className={length === l ? 'on' : ''} onClick={() => setLength(l)}>{t(`hair.${l}`)}</button>
          ))}
        </div>
      </div>
      <button
        className="btn"
        onClick={() => {
          set({ figura: true })
          doc.addHair(side, length, t('hair.defaultName', { side: t(`hair.${side}`), n: doc.hair.length + 1 }))
        }}
      >
        <Icon name="plus" />
        {t('hair.add')}
      </button>

      {doc.hair.length === 0 && <div className="muted" style={{ fontSize: 12 }}>{t('hair.empty')}</div>}
      <div className="hair-list">
        {doc.hair.map((h) => (
          <div key={h.id} className={'layer' + (h.id === doc.hairId ? ' on' : '') + (h.visible ? '' : ' hidden-layer')} onClick={() => doc.selectHair(h.id === doc.hairId ? null : h.id)}>
            <button className="icon-btn sm" onClick={(e) => (e.stopPropagation(), doc.updateHair(h.id, { visible: !h.visible }))}>
              <Icon name={h.visible ? 'eye' : 'eyeOff'} size={14} />
            </button>
            <span className="lname">{h.name}</span>
            <span className="tag">{t(`hair.${h.length}`)}</span>
            <button className="icon-btn sm" title={t('common.duplicate')} onClick={(e) => (e.stopPropagation(), doc.duplicateHair(h.id))}>
              <Icon name="copy" size={14} />
            </button>
            <button className="icon-btn sm" title={t('common.delete')} onClick={(e) => (e.stopPropagation(), doc.removeHair(h.id))}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
      </div>
      {sel && <HairProps doc={doc} h={sel} />}

      {doc.hair.length > 0 && (
        <label className="row muted" style={{ fontSize: 12 }}>
          <input type="checkbox" checked={hairOutlines} onChange={() => set({ hairOutlines: !hairOutlines })} />
          {t('hair.outlines')}
        </label>
      )}
      {/* test motions are always available on the skin page (they don't need hair or Preview) */}
      <div className="field" style={{ gap: 4 }}>
        <span className="muted">{t('hair.motion')}</span>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {MOTION_MODES.map((m: MotionMode) => (
            <button key={m} className={motion === m ? 'on' : ''} onClick={() => set({ motion: m })}>
              {t(`hair.motions.${m}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

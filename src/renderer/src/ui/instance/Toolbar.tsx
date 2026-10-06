import { useTranslation } from 'react-i18next'
import { useEditor, type PaintTarget, type Tool } from '../../store/editor'
import { Icon } from '../common/Icon'
import { parseHex, toHex } from '../../skin/color'

const TOOLS: [Tool, string][] = [
  ['brush', 'brush'],
  ['eraser', 'eraser'],
  ['bucket', 'bucket'],
  ['gradient', 'gradient'],
  ['picker', 'picker'],
  ['orbit', 'orbit']
]

function Slider({ label, value, min, max, step = 1, fmt, onChange }: { label: string; value: number; min: number; max: number; step?: number; fmt?: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="slider" title={label}>
      <span className="muted">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{fmt ? fmt(value) : value}</span>
    </label>
  )
}

export function Toolbar({ onResetView }: { onResetView: () => void }) {
  const { t } = useTranslation()
  const s = useEditor()
  const maxSize = Math.max(16, (s.doc?.res ?? 64) / 4)
  const b = s.tool === 'eraser' ? s.eraser : s.brush
  const pct = (v: number) => Math.round(v * 100) + '%'

  // pose mode: nothing to paint, just the view controls
  if (s.mode === 'pose')
    return (
      <div className="toolbar">
        <span className="muted" style={{ fontSize: 12, padding: '0 6px' }}>{t('pose.toolbarHint')}</span>
        <div className="grow" />
        <button className={'icon-btn' + (s.preview ? ' active' : '')} title={t('tools.preview')} onClick={() => s.set({ preview: !s.preview })}><Icon name="eye" size={17} /></button>
        <button className="icon-btn" title={t('tools.resetView')} onClick={onResetView}><Icon name="reset" size={17} /></button>
      </div>
    )

  return (
    <div className="toolbar">
      {TOOLS.map(([id, icon]) => (
        <button key={id} className={'icon-btn' + (s.tool === id ? ' active' : '')} title={t(`tools.${id}`)} onClick={() => s.set({ tool: id })}>
          <Icon name={icon} size={17} />
        </button>
      ))}
      <span className="sep" style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

      {(s.tool === 'brush' || s.tool === 'eraser') && (
        <>
          <Slider label={t('tools.size')} value={b.size} min={1} max={maxSize} onChange={(v) => s.setBrush({ size: v })} />
          <Slider label={t('tools.opacity')} value={b.opacity} min={0.05} max={1} step={0.05} fmt={pct} onChange={(v) => s.setBrush({ opacity: v })} />
          <Slider label={t('tools.softness')} value={b.softness} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => s.setBrush({ softness: v })} />
          <Slider label={t('tools.smooth')} value={b.smooth ?? 0} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => s.setBrush({ smooth: v })} />
          <div className="seg" title={t('tools.shape')}>
            <button className={b.shape === 'square' ? 'on' : ''} onClick={() => s.setBrush({ shape: 'square' })}>{t('tools.square')}</button>
            <button className={b.shape === 'circle' ? 'on' : ''} onClick={() => s.setBrush({ shape: 'circle' })}>{t('tools.circle')}</button>
          </div>
        </>
      )}
      {s.tool === 'gradient' && (
        <>
          <label className="grad-colors" title={t('tools.gradColors')}>
            <input type="color" value={toHex(s.color, false)} onChange={(e) => s.set({ color: parseHex(e.target.value) ?? s.color })} />
            <span className="grad-bar" style={{ background: `linear-gradient(90deg, ${toHex(s.color, false)}, ${toHex(s.color2, false)})` }} />
            <input type="color" value={toHex(s.color2, false)} onChange={(e) => s.set({ color2: parseHex(e.target.value) ?? s.color2 })} />
          </label>
          <button className="icon-btn sm" title={t('tools.swapColors')} onClick={() => s.set({ color: s.color2, color2: s.color })}><Icon name="swap" size={15} /></button>
          <Slider label={t('tools.gradSteps')} value={s.gradientSteps} min={0} max={16} fmt={(v) => (v ? String(v) : t('tools.gradSmooth'))} onChange={(v) => s.set({ gradientSteps: v === 1 ? 2 : v })} />
          <Slider label={t('tools.opacity')} value={s.brush.opacity} min={0.05} max={1} step={0.05} fmt={pct} onChange={(v) => s.set({ brush: { ...s.brush, opacity: v } })} />
          <span className="muted" style={{ fontSize: 11 }}>{t('tools.gradHint')}</span>
        </>
      )}
      {s.tool === 'bucket' && (
        <>
          <div className="seg">
            <button className={s.fillMode === 'face' ? 'on' : ''} onClick={() => s.set({ fillMode: 'face' })}>{t('tools.fillFace')}</button>
            <button className={s.fillMode === 'element' ? 'on' : ''} onClick={() => s.set({ fillMode: 'element' })}>{t('tools.fillElement')}</button>
          </div>
          <Slider label={t('tools.opacity')} value={s.brush.opacity} min={0.05} max={1} step={0.05} fmt={pct} onChange={(v) => s.set({ brush: { ...s.brush, opacity: v } })} />
        </>
      )}

      <div className="grow" />
      <label className="row muted" title={t('tools.target')}>
        {t('tools.target')}
        <select className="select" value={s.target} onChange={(e) => s.set({ target: e.target.value as PaintTarget })}>
          <option value="auto">{t('tools.targetAuto')}</option>
          <option value="base">{t('tools.targetBase')}</option>
          <option value="overlay">{t('tools.targetOverlay')}</option>
        </select>
      </label>
      <button className={'icon-btn' + (s.grid ? ' active' : '')} title={t('tools.grid')} onClick={() => s.set({ grid: !s.grid })}><Icon name="grid" size={17} /></button>
      <button className={'icon-btn' + (s.mirror ? ' active' : '')} title={t('tools.mirror')} onClick={() => s.set({ mirror: !s.mirror })}><Icon name="mirror" size={17} /></button>
      <button className={'icon-btn' + (s.preview ? ' active' : '')} title={t('tools.preview')} onClick={() => s.set({ preview: !s.preview })}><Icon name="user" size={17} /></button>
      <button className="icon-btn" title={t('tools.resetView')} onClick={onResetView}><Icon name="reset" size={17} /></button>
    </div>
  )
}

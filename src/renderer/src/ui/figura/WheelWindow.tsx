import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { DEFAULT_BUTTONS, orderedExprs, wheelButton, type ExprKey, type Expression, type WheelButton } from '../../skin/figura'
import { Icon } from '../common/Icon'
import { frameLabel } from './frameLabel'

/** Emoji names auria's wheel understands, shown as real emoji in the preview. */
const EMOJI: Record<string, string> = {
  smile: '😄', grin: '😁', blush: '😊', heart: '❤️', star: '⭐', sparkles: '✨', fox: '🦊', cat: '🐱', dog: '🐶',
  cry: '😢', sob: '😭', angry: '😠', rage: '😡', scream: '😱', thinking: '🤔', eyes: '👀', fire: '🔥', zzz: '💤',
  '+1': '👍', dragon: '🐉', notepad: '🗒️', sweat: '😅', wink: '😉', flushed: '😳', pensive: '😔'
}
const ICON_PICKS = ['minecraft:sunflower', 'minecraft:poppy', 'minecraft:blaze_powder', 'minecraft:spyglass', 'minecraft:water_bucket', 'minecraft:cake', 'minecraft:heart_of_the_sea', 'minecraft:totem_of_undying', 'minecraft:name_tag']
const EMOJI_PICKS = [':smile:', ':blush:', ':heart:', ':cry:', ':angry:', ':flushed:', ':thinking:', ':sparkles:']
const SLOTS = 8 // Figura shows 8 actions per page

const isEmoji = (s: string) => /^:[\w@+-]+:$/.test(s.trim())
const itemName = (s: string) => s.replace(/^minecraft:/, '').replace(/_/g, ' ')
/** Stable pastel colour per item id, so items are recognisable in the preview. */
const tint = (s: string) => `hsl(${[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 55% 62%)`

type Slot = { key: string; title: string; icon: string; color?: string; extra?: boolean }

/** Icon as the preview can show it: emoji glyphs, or an item badge with its name. */
function IconPreview({ icon, auria, size }: { icon: string; auria: boolean; size: number }) {
  if (isEmoji(icon)) {
    const name = icon.trim().slice(1, -1)
    // Figura's own wheel can't show emoji: the export uses a name tag instead
    if (!auria) return <ItemBadge id="minecraft:name_tag" size={size} />
    return <span style={{ fontSize: size * 0.7, lineHeight: 1 }}>{EMOJI[name] ?? icon}</span>
  }
  return <ItemBadge id={icon} size={size} />
}

function ItemBadge({ id, size }: { id: string; size: number }) {
  const name = itemName(id)
  return (
    <span className="item-badge" style={{ width: size, height: size, background: tint(id), fontSize: Math.max(8, size / 4.2) }} title={id}>
      {name.split(' ').map((w) => w[0]?.toUpperCase()).join('').slice(0, 3)}
    </span>
  )
}

/** SVG-ish wheel preview: buttons around a ring, paged like the real wheel. */
function WheelPreview({ slots, auria, title, selected, onSelect }: { slots: Slot[]; auria: boolean; title: string; selected: string | null; onSelect: (k: string) => void }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(0)
  const per = auria ? Math.max(1, slots.length) : SLOTS
  const pages = Math.max(1, Math.ceil(slots.length / per))
  const pg = Math.min(page, pages - 1)
  const shown = slots.slice(pg * per, pg * per + per)
  const R = 120
  const hover = shown.find((s) => s.key === selected)
  return (
    <div className="wheel-preview">
      <div className={'wheel-ring' + (auria ? ' auria' : '')}>
        <svg viewBox="-160 -160 320 320" width="100%" height="100%">
          <circle r={R + 34} className="ring-bg" />
          <circle r={R - 34} className="ring-hole" />
          {shown.map((s, i) => {
            const a = (i / Math.max(1, shown.length)) * Math.PI * 2 - Math.PI / 2
            const x = Math.cos(a) * R, y = Math.sin(a) * R
            return (
              <g key={s.key} transform={`translate(${x} ${y})`} onClick={() => onSelect(s.key)} className={'ring-slot' + (s.key === selected ? ' on' : '')}>
                <circle r={26} style={!auria && s.color ? { fill: s.color } : undefined} />
                <foreignObject x={-18} y={-18} width={36} height={36}>
                  <div className="slot-icon"><IconPreview icon={s.icon} auria={auria} size={30} /></div>
                </foreignObject>
              </g>
            )
          })}
          <text className="ring-title" y={-6} textAnchor="middle">{hover?.title ?? title}</text>
          <text className="ring-sub" y={14} textAnchor="middle">{hover ? (hover.extra ? t('wheel.extraButton') : hover.icon) : t('wheel.clickSlot')}</text>
        </svg>
      </div>
      {pages > 1 && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="icon-btn sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹</button>
          <span className="muted" style={{ fontSize: 12 }}>{t('wheel.page', { n: pg + 1, of: pages })}</span>
          <button className="icon-btn sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>›</button>
        </div>
      )}
      <span className="muted" style={{ fontSize: 11, textAlign: 'center' }}>{auria ? t('wheel.previewAuria') : t('wheel.previewFigura')}</span>
    </div>
  )
}

/** Detailed action-wheel settings with a live preview. */
export function WheelWindow({ doc, onClose }: { doc: SkinDoc; onClose: () => void }) {
  const { t } = useTranslation()
  const c = doc.figura
  const auria = c.wheel === 'auria'
  const order = orderedExprs(c).filter((e) => !!doc.faces[e])
  const [selected, setSelected] = useState<string | null>(order[0] ?? null)
  const physicsAvailable = c.hairPhysics && doc.hair.some((h) => h.visible)

  const set = (e: ExprKey, patch: Partial<WheelButton>) => {
    const cur = c.buttons[e] ?? { title: '', icon: '' }
    doc.updateFigura({ buttons: { ...c.buttons, [e]: { ...cur, ...patch } } })
  }
  const move = (e: ExprKey, dir: -1 | 1) => {
    const all = orderedExprs(c)
    const i = all.indexOf(e)
    const j = i + dir
    if (j < 0 || j >= all.length) return
    ;[all[i], all[j]] = [all[j], all[i]]
    doc.updateFigura({ wheelOrder: all })
  }

  const slots: Slot[] = order
    .filter((e) => !wheelButton(c, e).hidden)
    .map((e) => {
      const b = wheelButton(c, e)
      return { key: e, title: b.title, icon: b.icon, color: b.color }
    })
  if (c.wheelExtras.clear && slots.length) slots.push({ key: '__clear', title: 'Normal face', icon: 'minecraft:barrier', extra: true })
  if (c.wheelExtras.physics && physicsAvailable) slots.push({ key: '__phys', title: 'Hair physics', icon: 'minecraft:feather', extra: true })

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wardrobe" style={{ gridTemplateRows: 'auto 1fr auto' }}>
        <header className="wardrobe-head">
          <Icon name="sparkle" size={18} />
          <b>{t('wheel.title')}</b>
          <div className="grow" />
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="wardrobe-body">
          <div className="wardrobe-left wheel-left">
            <WheelPreview slots={slots} auria={auria} title={c.wheelTitle || 'Expressions'} selected={selected} onSelect={setSelected} />
          </div>
          <div className="wardrobe-right">
            <div className="field">
              <span className="label">{t('wheel.style')}</span>
              <div className="seg">
                <button className={!auria ? 'on' : ''} onClick={() => doc.updateFigura({ wheel: 'figura' })}>{t('figura.wheelFigura')}</button>
                <button className={auria ? 'on' : ''} onClick={() => doc.updateFigura({ wheel: 'auria' })}>{t('figura.wheelAuria')}</button>
              </div>
              <span className="muted" style={{ fontSize: 11 }}>{auria ? t('figura.wheelAuriaHint') : t('figura.wheelFiguraHint')}</span>
            </div>
            <label className="field">
              <span className="label">{t('wheel.pageTitle')}</span>
              <input className="input" value={c.wheelTitle} placeholder="Expressions" onChange={(e) => doc.updateFigura({ wheelTitle: e.target.value })} />
            </label>
            <div className="field">
              <span className="label">{t('wheel.extras')}</span>
              <label className="row"><input type="checkbox" checked={c.wheelExtras.clear} onChange={(e) => doc.updateFigura({ wheelExtras: { ...c.wheelExtras, clear: e.target.checked } })} />{t('wheel.extraClear')}</label>
              <label className="row" title={physicsAvailable ? '' : t('wheel.needsHair')}>
                <input type="checkbox" disabled={!physicsAvailable} checked={c.wheelExtras.physics && physicsAvailable} onChange={(e) => doc.updateFigura({ wheelExtras: { ...c.wheelExtras, physics: e.target.checked } })} />
                {t('wheel.extraPhysics')}
              </label>
            </div>
            <span className="label">{t('wheel.buttons')}</span>
            {order.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('figura.noExprFrames')}</span>}
            <div className="wheel-list">
              {order.map((e, i) => {
                const b = wheelButton(c, e)
                const own = c.buttons[e]
                const def = e.startsWith('x_') ? undefined : DEFAULT_BUTTONS[e as Expression]
                return (
                  <div key={e} className={'wheel-item' + (selected === e ? ' on' : '') + (b.hidden ? ' hidden-layer' : '')} onClick={() => setSelected(e)}>
                    <div className="row">
                      <button className="icon-btn sm" title={t('layers.visible')} onClick={(ev) => (ev.stopPropagation(), set(e, { hidden: !b.hidden }))}><Icon name={b.hidden ? 'eyeOff' : 'eye'} size={14} /></button>
                      <span className="wheel-icon"><IconPreview icon={b.icon} auria={auria} size={26} /></span>
                      <b className="grow">{frameLabel(t, c, e)}</b>
                      <button className="icon-btn sm" disabled={i === 0} onClick={(ev) => (ev.stopPropagation(), move(e, -1))}><Icon name="up" size={13} /></button>
                      <button className="icon-btn sm" disabled={i === order.length - 1} onClick={(ev) => (ev.stopPropagation(), move(e, 1))}><Icon name="down" size={13} /></button>
                    </div>
                    {selected === e && (
                      <div className="wheel-fields" onClick={(ev) => ev.stopPropagation()}>
                        <label className="field">
                          <span className="muted">{t('figura.buttonTitle')}</span>
                          <input className="input" placeholder={def?.title ?? b.title} value={own?.title ?? ''} onChange={(ev) => set(e, { title: ev.target.value })} />
                        </label>
                        <label className="field">
                          <span className="muted">{t('figura.buttonIcon')}</span>
                          <input className="input" placeholder={def?.icon ?? b.icon} value={own?.icon ?? ''} onChange={(ev) => set(e, { icon: ev.target.value })} />
                        </label>
                        <div className="icon-picks">
                          {ICON_PICKS.map((p) => (
                            <button key={p} className={'pick' + (b.icon === p ? ' on' : '')} title={p} onClick={() => set(e, { icon: p })}><ItemBadge id={p} size={22} /></button>
                          ))}
                          {EMOJI_PICKS.map((p) => (
                            <button key={p} className={'pick' + (b.icon === p ? ' on' : '')} title={auria ? p : t('wheel.emojiAuriaOnly')} onClick={() => set(e, { icon: p })}><IconPreview icon={p} auria size={22} /></button>
                          ))}
                        </div>
                        <div className="row">
                          <span className="muted">{t('wheel.color')}</span>
                          <input type="color" value={b.color ?? '#3c3f46'} disabled={auria} onChange={(ev) => set(e, { color: ev.target.value })} />
                          {b.color && <button className="btn sm-btn" onClick={() => set(e, { color: undefined })}>{t('wheel.noColor')}</button>}
                          {auria && <span className="muted" style={{ fontSize: 11 }}>{t('wheel.colorFiguraOnly')}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        <footer className="wardrobe-foot">
          <span className="muted" style={{ fontSize: 12 }}>{t('wheel.footer')}</span>
          <div className="grow" />
          <button className="btn primary" onClick={onClose}>{t('common.close')}</button>
        </footer>
      </div>
    </div>
  )
}

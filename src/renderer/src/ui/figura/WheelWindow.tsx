import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import {
  itemView,
  liveWheel,
  syncWheel,
  wheelId,
  wheelScreens,
  WHEEL_TOGGLES,
  type FiguraConfig,
  type WheelContext,
  type WheelItem,
  type WheelPage,
  type WheelToggle
} from '../../skin/figura'
import { usePack } from '../../mc/library'
import { MC_VERSIONS, type McPack, type McVersion } from '../../mc/pack'
import { Icon } from '../common/Icon'
import { IconPicker, PackNotice, WheelIconView } from './WheelIcons'
import { glowInfo } from '../../figura/avatar'

/** What this skin's avatar can do, so the preview matches the exported wheel. */
function wheelContext(doc: SkinDoc): WheelContext {
  const c = doc.figura
  return {
    frames: (f) => !!doc.faces[f] && (f !== 'blink' || c.blink) && (f !== 'talk' || c.talk),
    physics: c.hairPhysics && doc.hair.some((h) => h.visible),
    glow: glowInfo(doc)
  }
}

/** Why an item won't appear in game (null = it will). */
function inactive(c: FiguraConfig, ctx: WheelContext, it: WheelItem): string | null {
  if (it.hidden) return 'hidden'
  if (it.type === 'expr') return !c.expressions ? 'exprOff' : ctx.frames(it.expr!) ? null : 'noFrame'
  if (it.type === 'clear') return c.expressions ? null : 'exprOff'
  if (it.type === 'toggle') {
    if (it.toggle === 'physics') return ctx.physics ? null : 'noPhysics'
    if (it.toggle === 'blink') return c.blink && ctx.frames('blink') ? null : 'noBlink'
    if (it.toggle === 'talk') return c.talk && ctx.frames('talk') ? null : 'noTalk'
    if (it.toggle === 'glow') return ctx.glow && (ctx.glow.eyes || ctx.glow.skin || ctx.glow.hair.length) ? null : 'noGlow'
    if (it.toggle === 'glowEyes') return ctx.glow?.eyes ? null : 'noGlow'
    if (it.toggle === 'glowSkin') return ctx.glow?.skin ? null : 'noGlow'
    if (it.toggle?.startsWith('glowHair:')) return ctx.glow?.hair.includes(it.toggle.slice(9)) ? null : 'noGlow'
    return c.smoothHead ? null : 'noSmooth'
  }
  return null
}

interface PreviewProps {
  doc: SkinDoc
  pages: WheelPage[]
  pageId: string
  pack: McPack | null
  selected: string | null
  onSelect: (id: string) => void
  onOpenPage: (id: string) => void
}

/** Figura's built-in wheel: rings of up to 8 sectors with Back / Next, toggles light up. */
function FiguraPreview({ doc, pages, pageId, pack, selected, onSelect, onOpenPage }: PreviewProps) {
  const { t } = useTranslation()
  const c = doc.figura
  const [hover, setHover] = useState<string | null>(null)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const screens = useMemo(() => wheelScreens(pages), [pages])
  const [at, setAt] = useState(0)
  // a page picked outside the ring (tabs) opens on its first part
  useEffect(() => {
    if (screens[at]?.page !== pageId) setAt(Math.max(0, screens.findIndex((x) => x.page === pageId)))
  }, [pageId, screens, at])
  const screen = screens[Math.min(at, screens.length - 1)]
  type Slot = { id: string; title: string; it?: WheelItem; to?: number; nav?: 'back' | 'next' }
  const slots: Slot[] = (screen?.slots ?? []).map((sl) =>
    sl.kind === 'item' ? { id: sl.item.id, title: itemView(c, sl.item).title, it: sl.item, to: sl.to } : { id: '__' + sl.kind, title: t('wheel.' + sl.kind), to: sl.to, nav: sl.kind }
  )
  const open = (to: number) => {
    setAt(to)
    if (screens[to] && screens[to].page !== pageId) onOpenPage(screens[to].page)
  }
  const n = Math.max(1, slots.length)
  const R0 = 52, R1 = 128
  const arc = (a0: number, a1: number) => {
    const p = (r: number, a: number) => `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`
    const big = a1 - a0 > Math.PI ? 1 : 0
    return `M ${p(R1, a0)} A ${R1} ${R1} 0 ${big} 1 ${p(R1, a1)} L ${p(R0, a1)} A ${R0} ${R0} 0 ${big} 0 ${p(R0, a0)} Z`
  }
  const hov = slots.find((s) => s.id === (hover ?? selected))
  return (
    <div className="wheel-ring figura">
      <svg viewBox="-150 -150 300 300" width="100%" height="100%">
        {slots.length === 0 && <circle r={(R0 + R1) / 2} className="sector empty" strokeWidth={R1 - R0} fill="none" />}
        {slots.map((s, i) => {
          const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2
          const mid = (a0 + a1) / 2
          const x = Math.sin(mid) * ((R0 + R1) / 2), y = -Math.cos(mid) * ((R0 + R1) / 2)
          const v = s.it ? itemView(c, s.it) : null
          const isToggle = s.it?.type === 'toggle'
          const on = isToggle && (toggled[s.id] ?? true)
          const fill = on ? '#5ca85c' : v?.color
          return (
            <g
              key={s.id}
              className={'sector' + (s.id === selected ? ' sel' : '')}
              onMouseEnter={() => setHover(s.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => {
                if (s.nav) return open(s.to!)
                if (!s.it) return
                onSelect(s.id)
                if (s.to !== undefined) open(s.to)
                if (isToggle) setToggled((m) => ({ ...m, [s.id]: !on }))
              }}
            >
              <path d={arc(a0, a1)} style={fill ? { fill } : undefined} />
              <foreignObject x={x - 16} y={y - 16} width={32} height={32}>
                <div className="slot-icon">
                  <WheelIconView icon={v ? v.icon : { kind: 'item', id: s.nav === 'next' ? 'minecraft:spectral_arrow' : 'minecraft:arrow' }} doc={doc} pack={pack} size={28} auria={false} />
                </div>
              </foreignObject>
            </g>
          )
        })}
        <text className="ring-title" y={-2} textAnchor="middle">{hov?.title ?? ''}</text>
        <text className="ring-sub" y={16} textAnchor="middle">{hov?.it?.type === 'toggle' ? t('wheel.toggleHint') : screen && screen.parts > 1 ? `${screen.part + 1} / ${screen.parts}` : ''}</text>
      </svg>
    </div>
  )
}

/** Auria's wheel: tinted backdrop, breadcrumbs, round buttons, switches under toggles. */
function AuriaPreview({ doc, pages, pageId, pack, selected, onSelect, onOpenPage }: PreviewProps) {
  const c = doc.figura
  const a = c.auriaStyle
  const [hover, setHover] = useState<string | null>(null)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [group, setGroup] = useState(0)
  const page = pages.find((p) => p.id === pageId) ?? pages[0]
  // breadcrumb trail: Home > ... > this page (first link found)
  const trail = useMemo(() => {
    const out: WheelPage[] = [page]
    for (let guard = 0; guard < 8 && out[0] !== pages[0]; guard++) {
      const par = pages.find((p) => p.items.some((it) => it.type === 'page' && it.page === out[0].id))
      if (!par || out.includes(par)) break
      out.unshift(par)
    }
    if (out[0] !== pages[0]) out.unshift(pages[0])
    return out
  }, [pages, page])
  useEffect(() => setGroup(0), [pageId])
  // sub-pages get a Back button (exported the same way)
  const all: WheelItem[] = trail.length > 1 ? [...page.items, { id: '__back', type: 'page', page: trail[trail.length - 2].id, title: 'Back', icon: { kind: 'item', id: 'minecraft:arrow' } }] : page.items
  const per = page.groupSize ? Math.max(2, page.groupSize) : Math.max(1, all.length)
  const groups = Math.max(1, Math.ceil(all.length / per))
  const gi = Math.min(group, groups - 1)
  const items = all.slice(gi * per, gi * per + per)
  const n = Math.max(1, items.length)
  const R = 96
  const hov = items.find((it) => it.id === (hover ?? selected))
  const rgb = /^#?([0-9a-f]{6})$/i.exec(a.overlay)?.[1] ?? '33383f'
  const bg = `rgba(${parseInt(rgb.slice(0, 2), 16)}, ${parseInt(rgb.slice(2, 4), 16)}, ${parseInt(rgb.slice(4, 6), 16)}, ${a.overlayAlpha})`
  return (
    <div className={'wheel-ring auria' + (a.blur ? ' blur' : '') + (a.animations ? ' anim' : '')} style={{ ['--auria-bg' as string]: bg }} onContextMenu={(e) => (e.preventDefault(), trail.length > 1 && onOpenPage(trail[trail.length - 2].id))}>
      <div className="auria-crumbs">
        {trail.map((p, i) => (
          <span key={p.id} onClick={() => onOpenPage(p.id)}>
            {i > 0 && <b>›</b>}
            {i === 0 ? '⌂ ' : ''}
            {p.title || 'Page'}
          </span>
        ))}
      </div>
      <svg viewBox="-150 -150 300 300" width="100%" height="100%">
        {items.map((it, i) => {
          const ang = (i / n) * Math.PI * 2 - Math.PI / 2
          const x = Math.cos(ang) * R, y = Math.sin(ang) * R
          const v = itemView(c, it)
          const on = toggled[it.id] ?? true
          return (
            <g
              key={it.id}
              transform={`translate(${x} ${y})`}
              className={'auria-btn' + (it.id === selected ? ' sel' : '')}
              onMouseEnter={() => setHover(it.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => {
                onSelect(it.id)
                if (it.type === 'page' && it.page) onOpenPage(it.page)
                if (it.type === 'home') onOpenPage(pages.some((x) => x.id === it.page) ? it.page! : pages[0].id)
                if (it.type === 'toggle') setToggled((m) => ({ ...m, [it.id]: !on }))
              }}
            >
              <circle r={25} />
              <foreignObject x={-15} y={-15} width={30} height={30}>
                <div className="slot-icon"><WheelIconView icon={v.icon} doc={doc} pack={pack} size={26} auria /></div>
              </foreignObject>
              {it.type === 'toggle' && (
                <g transform="translate(-9 31)">
                  <rect width={18} height={9} rx={4.5} className={'auria-switch' + (on ? ' on' : '')} />
                  <circle cx={on ? 13.5 : 4.5} cy={4.5} r={3.2} fill="#fff" />
                </g>
              )}
            </g>
          )
        })}
        <text className="ring-title light" y={4} textAnchor="middle">{hov ? itemView(c, hov).title : ''}</text>
      </svg>
      {groups > 1 && (
        <div className="auria-groups">
          <button onClick={() => setGroup((gi + groups - 1) % groups)}>‹</button>
          {gi + 1} / {groups}
          <button onClick={() => setGroup((gi + 1) % groups)}>›</button>
        </div>
      )}
    </div>
  )
}

/** Detailed action-wheel editor (pages, buttons, icons) with a live preview of the real wheel. */
export function WheelWindow({ doc, onClose }: { doc: SkinDoc; onClose: () => void }) {
  const { t } = useTranslation()
  const c = doc.figura
  const auria = c.wheel === 'auria'
  const version = c.iconVersion as McVersion
  const pack = usePack(version)
  const ready = pack.status === 'ready' ? pack.pack : null
  const pages = syncWheel(c)
  const ctx = wheelContext(doc)
  const live = liveWheel(c, ctx)
  const [pageId, setPageId] = useState(pages[0].id)
  const page = pages.find((p) => p.id === pageId) ?? pages[0]
  const [sel, setSel] = useState<string | null>(page.items[0]?.id ?? null)
  const [picking, setPicking] = useState<string | null>(null)
  const item = page.items.find((i) => i.id === sel) ?? null

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !picking && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose, picking])

  const save = (next: WheelPage[]) => doc.updateFigura({ wheelPages: next })
  const editPage = (patch: Partial<WheelPage>) => save(pages.map((p) => (p.id === page.id ? { ...p, ...patch } : p)))
  const editItem = (id: string, patch: Partial<WheelItem>) => editPage({ items: page.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })
  const move = (id: string, dir: -1 | 1) => {
    const items = [...page.items]
    const i = items.findIndex((x) => x.id === id)
    const j = i + dir
    if (j < 0 || j >= items.length) return
    ;[items[i], items[j]] = [items[j], items[i]]
    editPage({ items })
  }
  const moveTo = (id: string, target: string) => {
    const it = page.items.find((x) => x.id === id)
    if (!it || target === page.id) return
    save(pages.map((p) => (p.id === page.id ? { ...p, items: p.items.filter((x) => x.id !== id) } : p.id === target ? { ...p, items: [...p.items, it] } : p)))
    setSel(null)
  }
  const addItem = (it: WheelItem) => {
    editPage({ items: [...page.items, it] })
    setSel(it.id)
  }
  const addPage = () => {
    const np: WheelPage = { id: wheelId(), title: `Page ${pages.length + 1}`, items: [] }
    // link it from the page being edited so it can be reached
    const link: WheelItem = { id: wheelId(), type: 'page', page: np.id, title: '' }
    save([...pages.map((p) => (p.id === page.id ? { ...p, items: [...p.items, link] } : p)), np])
    setPageId(np.id)
    setSel(null)
  }
  const deletePage = () => {
    if (page === pages[0]) return
    // its expressions go back to the auto page (syncWheel re-adds them)
    save(pages.filter((p) => p.id !== page.id).map((p) => (page.auto && p === pages[0] ? { ...p, auto: true } : p)))
    setPageId(pages[0].id)
  }
  const reachable = (id: string) => id === pages[0].id || pages.some((p) => p.items.some((it) => it.type === 'page' && it.page === id))
  const otherPages = pages.filter((p) => p.id !== page.id)
  const toggleChoices: [WheelToggle, string][] = [
    ...WHEEL_TOGGLES.map((tg): [WheelToggle, string] => [tg, t('wheel.toggle_' + tg)]),
    ...doc.hair.map((h): [WheelToggle, string] => [`glowHair:${h.id}`, t('wheel.toggle_glowHair', { name: h.name })])
  ]

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wardrobe wheel-window">
        <header className="wardrobe-head">
          <Icon name="sparkle" size={18} />
          <b>{t('wheel.title')}</b>
          <div className="seg" style={{ marginLeft: 12 }}>
            <button className={!auria ? 'on' : ''} onClick={() => doc.updateFigura({ wheel: 'figura' })}>{t('figura.wheelFigura')}</button>
            <button className={auria ? 'on' : ''} onClick={() => doc.updateFigura({ wheel: 'auria' })}>{t('figura.wheelAuria')}</button>
          </div>
          <div className="grow" />
          <label className="row" style={{ gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>{t('wheel.iconVersion')}</span>
            <select className="input" value={version} onChange={(e) => doc.updateFigura({ iconVersion: e.target.value as McVersion })}>
              {MC_VERSIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="wardrobe-body">
          <div className="wardrobe-left wheel-left">
            <div className="wheel-tabs">
              {live.map((p) => (
                <button key={p.id} className={p.id === page.id ? 'on' : ''} onClick={() => (setPageId(p.id), setSel(p.items[0]?.id ?? null))}>{p.title || 'Page'}</button>
              ))}
            </div>
            {auria ? (
              <AuriaPreview doc={doc} pages={live} pageId={page.id} pack={ready} selected={sel} onSelect={setSel} onOpenPage={(id) => (setPageId(id), setSel(null))} />
            ) : (
              <FiguraPreview doc={doc} pages={live} pageId={page.id} pack={ready} selected={sel} onSelect={setSel} onOpenPage={(id) => (setPageId(id), setSel(null))} />
            )}
            <PackNotice state={pack} version={version} />
            <span className="muted wheel-cap">{auria ? t('wheel.previewAuria') : t('wheel.previewFigura')}</span>
          </div>

          <div className="wardrobe-right">
            {/* pages */}
            <div className="field">
              <div className="section-head">
                <span className="label">{t('wheel.pages')}</span>
                <button className="btn sm-btn" onClick={addPage}><Icon name="plus" size={13} />{t('wheel.addPage')}</button>
              </div>
              <div className="page-chips">
                {pages.map((p, i) => (
                  <button key={p.id} className={'page-chip' + (p.id === page.id ? ' on' : '') + (reachable(p.id) ? '' : ' warn')} onClick={() => (setPageId(p.id), setSel(p.items[0]?.id ?? null))}>
                    {i === 0 && '⌂ '}
                    {p.title || 'Page'}
                    <span className="muted"> {p.items.length}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="wheel-page-props">
              <label className="field grow">
                <span className="muted">{t('wheel.pageTitle')}</span>
                <input className="input" value={page.title} onChange={(e) => editPage({ title: e.target.value })} />
              </label>
              {auria && (
                <label className="field" style={{ width: 120 }}>
                  <span className="muted">{t('wheel.groupSize')}</span>
                  <input className="input" type="number" min={0} max={16} value={page.groupSize ?? 0} onChange={(e) => editPage({ groupSize: Number(e.target.value) || undefined })} />
                </label>
              )}
              <label className="row" title={t('wheel.autoHint')}>
                <input type="radio" checked={!!page.auto || (!pages.some((p) => p.auto) && page === pages[0])} onChange={() => save(pages.map((p) => ({ ...p, auto: p.id === page.id })))} />
                {t('wheel.auto')}
              </label>
              {page !== pages[0] && (
                <button className="btn sm-btn danger" onClick={deletePage}><Icon name="trash" size={13} />{t('wheel.deletePage')}</button>
              )}
            </div>
            {!reachable(page.id) && <span className="warn-text">{t('wheel.unreachable')}</span>}

            {/* buttons */}
            <div className="section-head">
              <span className="label">{t('wheel.buttons')}</span>
              <div className="row" style={{ gap: 4 }}>
                <select
                  className="input sm"
                  value=""
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) return
                    if (v === 'clear') addItem({ id: wheelId(), type: 'clear', title: '' })
                    else if (v === 'home') addItem({ id: wheelId(), type: 'home', title: '' })
                    else if (v.startsWith('page:')) addItem({ id: wheelId(), type: 'page', page: v.slice(5), title: '' })
                    else addItem({ id: wheelId(), type: 'toggle', toggle: v.slice(7) as WheelToggle, title: '' })
                  }}
                >
                  <option value="">{t('wheel.addButton')}</option>
                  <optgroup label={t('wheel.type_toggle')}>
                    {toggleChoices.map(([tg, label]) => <option key={tg} value={'toggle:' + tg}>{label}</option>)}
                  </optgroup>
                  {otherPages.length > 0 && (
                    <optgroup label={t('wheel.type_page')}>
                      {otherPages.map((p) => <option key={p.id} value={'page:' + p.id}>{p.title || 'Page'}</option>)}
                    </optgroup>
                  )}
                  <option value="home">{t('wheel.type_home')}</option>
                  <option value="clear">{t('wheel.type_clear')}</option>
                </select>
              </div>
            </div>
            {page.items.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('wheel.emptyPage')}</span>}
            <div className="wheel-list">
              {page.items.map((it, i) => {
                const v = itemView(c, it)
                const why = inactive(c, ctx, it)
                return (
                  <div key={it.id} className={'wheel-item' + (sel === it.id ? ' on' : '') + (why ? ' hidden-layer' : '')} onClick={() => setSel(it.id)}>
                    <div className="row">
                      <button className="icon-btn sm" title={t('layers.visible')} onClick={(e) => (e.stopPropagation(), editItem(it.id, { hidden: !it.hidden }))}><Icon name={it.hidden ? 'eyeOff' : 'eye'} size={14} /></button>
                      <span className="wheel-icon"><WheelIconView icon={v.icon} doc={doc} pack={ready} size={26} auria={auria} /></span>
                      <span className="grow wheel-item-name">
                        <b>{v.title}</b>
                        <span className="muted">{t('wheel.type_' + it.type)}{it.type === 'toggle' ? ' · ' + (toggleChoices.find(([tg]) => tg === it.toggle)?.[1] ?? '') : ''}{why && why !== 'hidden' ? ' · ' + t('wheel.why_' + why) : ''}</span>
                      </span>
                      <button className="icon-btn sm" disabled={i === 0} onClick={(e) => (e.stopPropagation(), move(it.id, -1))}><Icon name="up" size={13} /></button>
                      <button className="icon-btn sm" disabled={i === page.items.length - 1} onClick={(e) => (e.stopPropagation(), move(it.id, 1))}><Icon name="down" size={13} /></button>
                    </div>
                    {item?.id === it.id && (
                      <div className="wheel-fields" onClick={(e) => e.stopPropagation()}>
                        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
                          <button className="icon-pick-btn" title={t('wheel.changeIcon')} onClick={() => setPicking(it.id)}>
                            <WheelIconView icon={v.icon} doc={doc} pack={ready} size={40} auria={auria} />
                            <span>{t('wheel.changeIcon')}</span>
                          </button>
                          <label className="field grow">
                            <span className="muted">{t('figura.buttonTitle')}</span>
                            <input className="input" placeholder={v.title} value={it.title} onChange={(e) => editItem(it.id, { title: e.target.value })} />
                          </label>
                        </div>
                        {it.type === 'page' && (
                          <label className="field">
                            <span className="muted">{t('wheel.opens')}</span>
                            <select className="input" value={it.page} onChange={(e) => editItem(it.id, { page: e.target.value })}>
                              {otherPages.map((p) => <option key={p.id} value={p.id}>{p.title || 'Page'}</option>)}
                            </select>
                          </label>
                        )}
                        {it.type === 'home' && (
                          <label className="field">
                            <span className="muted">{t('wheel.homeTarget')}</span>
                            <select className="input" value={it.page ?? ''} onChange={(e) => editItem(it.id, { page: e.target.value || undefined })}>
                              <option value="">{t('wheel.firstPage')}</option>
                              {pages.slice(1).map((p) => <option key={p.id} value={p.id}>{p.title || 'Page'}</option>)}
                            </select>
                          </label>
                        )}
                        {it.type === 'toggle' && (
                          <label className="field">
                            <span className="muted">{t('wheel.switches')}</span>
                            <select className="input" value={it.toggle} onChange={(e) => editItem(it.id, { toggle: e.target.value as WheelToggle })}>
                              {toggleChoices.map(([tg, label]) => <option key={tg} value={tg}>{label}</option>)}
                            </select>
                          </label>
                        )}
                        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                          <span className="muted">{t('wheel.color')}</span>
                          <input type="color" value={it.color ?? '#3c3f46'} disabled={auria} onChange={(e) => editItem(it.id, { color: e.target.value })} />
                          {it.color && <button className="btn sm-btn" onClick={() => editItem(it.id, { color: undefined })}>{t('wheel.noColor')}</button>}
                          {auria && <span className="muted" style={{ fontSize: 11 }}>{t('wheel.colorFiguraOnly')}</span>}
                          <div className="grow" />
                          {it.icon && <button className="btn sm-btn" onClick={() => editItem(it.id, { icon: undefined })}>{t('wheel.defaultIcon')}</button>}
                          {otherPages.length > 0 && (
                            <select className="input sm" value="" onChange={(e) => e.target.value && moveTo(it.id, e.target.value)}>
                              <option value="">{t('wheel.moveTo')}</option>
                              {otherPages.map((p) => <option key={p.id} value={p.id}>{p.title || 'Page'}</option>)}
                            </select>
                          )}
                          {it.type !== 'expr' && (
                            <button className="btn sm-btn danger" onClick={() => (editPage({ items: page.items.filter((x) => x.id !== it.id) }), setSel(null))}>
                              <Icon name="trash" size={13} />
                              {t('common.delete')}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {auria && (
              <div className="field auria-style">
                <span className="label">{t('wheel.auriaStyle')}</span>
                <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
                  <label className="row">
                    {t('wheel.overlay')}
                    <input type="color" value={c.auriaStyle.overlay} onChange={(e) => doc.updateFigura({ auriaStyle: { ...c.auriaStyle, overlay: e.target.value } })} />
                  </label>
                  <label className="row grow">
                    {t('wheel.overlayAlpha')}
                    <input type="range" min={0} max={1} step={0.05} value={c.auriaStyle.overlayAlpha} onChange={(e) => doc.updateFigura({ auriaStyle: { ...c.auriaStyle, overlayAlpha: Number(e.target.value) } })} />
                  </label>
                  <label className="row">
                    <input type="checkbox" checked={c.auriaStyle.blur} onChange={(e) => doc.updateFigura({ auriaStyle: { ...c.auriaStyle, blur: e.target.checked } })} />
                    {t('wheel.blur')}
                  </label>
                </div>
                <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
                  <span className="muted">{t('wheel.mode')}</span>
                  <div className="seg">
                    {(['HOLD', 'MIXED', 'TOGGLE'] as const).map((m) => (
                      <button key={m} className={c.auriaStyle.mode === m ? 'on' : ''} title={t('wheel.mode_' + m + '_hint')} onClick={() => doc.updateFigura({ auriaStyle: { ...c.auriaStyle, mode: m } })}>{t('wheel.mode_' + m)}</button>
                    ))}
                  </div>
                  {c.auriaStyle.mode === 'MIXED' && (
                    <label className="row">
                      {t('wheel.holdTime')}
                      <input className="input" type="number" min={50} max={2000} step={50} style={{ width: 80 }} value={c.auriaStyle.holdTime} onChange={(e) => doc.updateFigura({ auriaStyle: { ...c.auriaStyle, holdTime: Number(e.target.value) || 250 } })} />
                      ms
                    </label>
                  )}
                </div>
                <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
                  <label className="row">
                    <input type="checkbox" checked={c.auriaStyle.animations} onChange={(e) => doc.updateFigura({ auriaStyle: { ...c.auriaStyle, animations: e.target.checked } })} />
                    {t('wheel.animations')}
                  </label>
                  <label className="row grow">
                    {t('wheel.animSpeed')}
                    <input type="range" min={0.05} max={1} step={0.05} disabled={!c.auriaStyle.animations} value={c.auriaStyle.animationSpeed} onChange={(e) => doc.updateFigura({ auriaStyle: { ...c.auriaStyle, animationSpeed: Number(e.target.value) } })} />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
        <footer className="wardrobe-foot">
          <span className="muted" style={{ fontSize: 12 }}>{t('wheel.footer')}</span>
          <div className="grow" />
          <button className="btn primary" onClick={onClose}>{t('common.close')}</button>
        </footer>
      </div>
      {picking && (
        <IconPicker
          doc={doc}
          version={version}
          auria={auria}
          value={itemView(c, page.items.find((x) => x.id === picking) ?? page.items[0]).icon}
          onClose={() => setPicking(null)}
          onPick={(icon) => {
            editItem(picking, { icon })
            setPicking(null)
          }}
        />
      )}
    </div>
  )
}

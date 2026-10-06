import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { exprKeys, liveWheel, toEnglish, type FiguraConfig } from '../../skin/figura'
import { frameLabel } from './frameLabel'
import { buildAvatar, glowInfo, type AvatarFiles } from '../../figura/avatar'
import { storage, type AvatarMeta } from '../../lib/storage'
import { useEditor } from '../../store/editor'
import { MOTION_MODES } from '../../three/motion'
import { Icon } from '../common/Icon'
import { AttachWindow } from './AvatarLibrary'
import { WheelWindow } from './WheelWindow'

const LIMIT = 100 * 1024
const CLOUD = 'https://figura-sirufree.shirounetwork.com'
const kb = (n: number) => (n / 1024).toFixed(1) + ' KB'

function Toggle({ label, on, onChange, children }: { label: string; on: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return (
    <div className="fig-opt">
      <label className="row">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
        <span className="grow">{label}</span>
      </label>
      {on && children && <div className="fig-sub">{children}</div>}
    </div>
  )
}

function Range({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt?: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="phys-row">
      <span className="muted">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{fmt ? fmt(value) : value}</span>
    </label>
  )
}

/** Avatar name/author/description default from the skin; everything exported is English. */
export const avatarMeta = (doc: SkinDoc) => ({
  name: toEnglish(doc.figura.avatarName) || toEnglish(doc.name) || 'My Avatar',
  author: toEnglish(doc.figura.author),
  description: toEnglish(doc.figura.description)
})

function SizeMeter({ doc }: { doc: SkinDoc }) {
  const { t } = useTranslation()
  const tick = useEditor((s) => s.tick)
  const [res, setRes] = useState<AvatarFiles | null>(null)
  useEffect(() => {
    let stale = false
    // debounce: rebuilding the avatar re-encodes the texture
    const id = setTimeout(() => buildAvatar(doc, avatarMeta(doc)).then((r) => !stale && setRes(r)), 400)
    return () => {
      stale = true
      clearTimeout(id)
    }
  }, [doc, tick])
  const over = !!res && res.size > LIMIT
  return (
    <div className="section">
      <div className="section-head">
        <span className="label">{t('figura.size')}</span>
        <b className={over ? 'size-over' : ''}>{res ? '≈ ' + kb(res.size) : t('figura.calculating')}</b>
      </div>
      <div className="size-bar"><div style={{ width: `${Math.min(100, ((res?.size ?? 0) / LIMIT) * 100)}%` }} className={over ? 'over' : ''} /></div>
      {res && <span className="muted" style={{ fontSize: 11 }}>{t('figura.breakdown', { t: kb(res.breakdown.texture), s: kb(res.breakdown.scripts), m: kb(res.breakdown.model) })}</span>}
      <div className="field">
        <span className="muted" style={{ fontSize: 12 }}>{t('figura.skinParts')}</span>
        <div className="seg">
          <button className={doc.figura.skinParts === 'needed' ? 'on' : ''} onClick={() => doc.updateFigura({ skinParts: 'needed' })}>{t('figura.partsNeeded')}</button>
          <button className={doc.figura.skinParts === 'all' ? 'on' : ''} onClick={() => doc.updateFigura({ skinParts: 'all' })}>{t('figura.partsAll')}</button>
        </div>
        <span className="muted" style={{ fontSize: 11 }}>
          {doc.figura.skinParts === 'needed' ? (doc.figura.smoothHead ? t('figura.partsNeededHead') : t('figura.partsNeededNone')) : t('figura.partsAllHint')}
          {doc.figura.skinParts === 'needed' && doc.res > 64 ? ' ' + t('figura.partsHdNote') : ''}
        </span>
      </div>
      {res && (over ? (
        <div className="size-warn">
          <Icon name="warn" size={14} />
          <span>
            {t('figura.sizeOver')}{' '}
            <a href={CLOUD} target="_blank" rel="noreferrer">{t('figura.cloud')}</a>
          </span>
        </div>
      ) : (
        <span className="muted" style={{ fontSize: 12 }}>✓ {t('figura.sizeOk')}</span>
      ))}
    </div>
  )
}

/** Wheel summary in the panel; the full editor opens in its own window. */
function WheelSummary({ doc }: { doc: SkinDoc }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const c = doc.figura
  const pages = liveWheel(c, {
    frames: (f) => !!doc.faces[f],
    physics: c.hairPhysics && doc.hair.some((h) => h.visible),
    glow: glowInfo(doc)
  })
  const count = pages.reduce((n, p) => n + p.items.length, 0)
  return (
    <div className="wheel-edit">
      <span className="muted" style={{ fontSize: 12 }}>{t('wheel.summary', { style: c.wheel === 'auria' ? t('figura.wheelAuria') : t('figura.wheelFigura'), n: count, p: pages.length })}</span>
      <button className="btn" onClick={() => setOpen(true)}><Icon name="settings" />{t('wheel.open')}</button>
      {open && <WheelWindow doc={doc} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** Library avatars used with this skin: toggled in the preview, exported as separate folders. */
function AttachedAvatars({ doc }: { doc: SkinDoc }) {
  const { t } = useTranslation()
  const [lib, setLib] = useState<AvatarMeta[]>([])
  const [picking, setPicking] = useState(false)
  const attached = doc.figura.attached
  useEffect(() => {
    storage.listAvatars().then(setLib)
  }, [picking])
  const meta = (id: string) => lib.find((a) => a.id === id)
  return (
    <div className="section">
      <div className="section-head">
        <span className="label">{t('figura.attached')}</span>
        <button className="btn sm-btn" onClick={() => setPicking(true)}><Icon name="plus" size={13} />{t('figura.addFigura')}</button>
      </div>
      {attached.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('figura.attachedEmpty')}</span>}
      {attached.map((a) => {
        const m = meta(a.id)
        const thumb = m?.thumb3d ?? m?.thumb
        return (
          <div key={a.id} className={'layer' + (a.enabled ? '' : ' hidden-layer')}>
            <button className="icon-btn sm" onClick={() => doc.updateFigura({ attached: attached.map((x) => (x.id === a.id ? { ...x, enabled: !x.enabled } : x)) })}>
              <Icon name={a.enabled ? 'eye' : 'eyeOff'} size={14} />
            </button>
            {thumb ? <img className="lthumb" src={thumb} alt="" /> : <span className="lthumb" />}
            <span className="lname">{m?.name ?? t('figura.missingAvatar')}</span>
            <button className="icon-btn sm" title={t('common.delete')} onClick={() => doc.updateFigura({ attached: attached.filter((x) => x.id !== a.id) })}><Icon name="x" size={13} /></button>
          </div>
        )
      })}
      {picking && (
        <AttachWindow
          initial={attached.map((a) => a.id)}
          onClose={() => setPicking(false)}
          onApply={(ids) => {
            doc.updateFigura({ attached: ids.map((id) => attached.find((a) => a.id === id) ?? { id, enabled: true }) })
            setPicking(false)
          }}
        />
      )}
    </div>
  )
}

export function FiguraPanel({ doc }: { doc: SkinDoc }) {
  const { t } = useTranslation()
  useEditor((s) => s.tick)
  const { figura: preview, figExpr, figTalk, motion, set } = useEditor()
  const c = doc.figura
  const up = (p: Partial<FiguraConfig>) => doc.updateFigura(p)

  return (
    <div className="panel-scroll">
      {!preview && <div className="section"><span className="muted" style={{ fontSize: 12 }}>{t('figura.previewOff')}</span><button className="btn" onClick={() => set({ figura: true })}><Icon name="sparkle" />Preview</button></div>}
      <SizeMeter doc={doc} />
      <div className="section">
        <span className="muted">{t('hair.motion')}</span>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {MOTION_MODES.map((m) => (
            <button key={m} className={motion === m ? 'on' : ''} onClick={() => set({ motion: m })}>{t(`hair.motions.${m}`)}</button>
          ))}
        </div>
      </div>

      <AttachedAvatars doc={doc} />

      <div className="section">
        <span className="label">{t('figura.head')}</span>
        <Toggle label={t('figura.smoothHead')} on={c.smoothHead} onChange={(v) => up({ smoothHead: v })}>
          <Range label={t('figura.headSpeed')} value={c.headSpeed} min={0.05} max={1} step={0.05} fmt={(v) => Math.round(v * 100) + '%'} onChange={(v) => up({ headSpeed: v })} />
          <Range label={t('figura.headTilt')} value={c.headTilt ?? 0} min={0} max={30} step={1} fmt={(v) => v + '°'} onChange={(v) => up({ headTilt: v })} />
        </Toggle>
        <Toggle label={t('figura.hairPhysics')} on={c.hairPhysics} onChange={(v) => up({ hairPhysics: v })}>
          <label className="row muted" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={c.swingAxis === -1} onChange={(e) => up({ swingAxis: e.target.checked ? -1 : 1 })} />
            {t('figura.swingFlip')}
          </label>
        </Toggle>
        <Toggle label={t('figura.blink')} on={c.blink} onChange={(v) => up({ blink: v })}>
          {/* blink at a random moment between the two times, in seconds */}
          <div className="row blink-secs">
            <span className="muted">{t('figura.blinkEvery')}</span>
            <input className="input num" type="number" min={0.5} max={30} step={0.5} value={c.blinkMin} onChange={(e) => e.target.value && up({ blinkMin: Math.max(0.5, Number(e.target.value)), blinkMax: Math.max(c.blinkMax, Number(e.target.value)) })} />
            <span className="muted">–</span>
            <input className="input num" type="number" min={0.5} max={30} step={0.5} value={c.blinkMax} onChange={(e) => e.target.value && up({ blinkMax: Math.max(0.5, Number(e.target.value)), blinkMin: Math.min(c.blinkMin, Number(e.target.value)) })} />
            <span className="muted">{t('figura.seconds')}</span>
          </div>
          <span className="muted" style={{ fontSize: 11 }}>{t('figura.blinkDrawHint')}</span>
        </Toggle>
      </div>

      <div className="section">
        <Toggle label={t('figura.expressions')} on={c.expressions} onChange={(v) => up({ expressions: v })}>
          <span className="muted" style={{ fontSize: 12 }}>{t('figura.previewExpr')}</span>
          <div className="expr-grid">
            <button className={'btn sm-btn' + (figExpr === null ? ' primary' : '')} onClick={() => set({ figExpr: null })}>{t('figura.none')}</button>
            {exprKeys(c).map((e) => (
              <button key={e} className={'btn sm-btn' + (figExpr === e ? ' primary' : '')} disabled={!doc.faces[e]} onClick={() => set({ figExpr: figExpr === e ? null : e })}>
                {frameLabel(t, c, e)}
              </button>
            ))}
          </div>
          <span className="label" style={{ marginTop: 6 }}>{t('figura.actionWheel')}</span>
          <WheelSummary doc={doc} />
        </Toggle>
        <Toggle label={t('figura.talk')} on={c.talk} onChange={(v) => up({ talk: v })}>
          <span className="muted" style={{ fontSize: 11 }}>{t('figura.talkHelp')}</span>
          <Range label={t('figura.talkThreshold')} value={c.talkThreshold} min={0} max={0.5} step={0.01} onChange={(v) => up({ talkThreshold: v })} />
          <button className={'btn sm-btn' + (figTalk ? ' primary' : '')} disabled={!doc.faces.talk} onClick={() => set({ figTalk: !figTalk })}>
            {t('figura.testTalk')}
          </button>
        </Toggle>
      </div>
    </div>
  )
}

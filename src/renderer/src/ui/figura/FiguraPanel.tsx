import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkinDoc } from '../../skin/doc'
import { exprKeys, toEnglish, type EarType, type FiguraConfig, type TailType } from '../../skin/figura'
import { frameLabel } from './frameLabel'
import { buildAvatar, type AvatarFiles } from '../../figura/avatar'
import { storage } from '../../lib/storage'
import { useEditor } from '../../store/editor'
import { toast } from '../common/dialogs'
import { MOTION_MODES } from '../../three/motion'
import { MergeWindow } from './AvatarLibrary'
import { Icon } from '../common/Icon'

const LIMIT = 100 * 1024
const CLOUD = 'https://figura-sirufree.shirounetwork.com'
const kb = (n: number) => (n / 1024).toFixed(1) + ' KB'
const TYPES: EarType[] = ['none', 'cat', 'fox', 'bunny', 'wolf']

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

export function FiguraPanel({ doc }: { doc: SkinDoc }) {
  const { t } = useTranslation()
  useEditor((s) => s.tick)
  const { figura: preview, figExpr, figTalk, motion, set } = useEditor()
  const c = doc.figura
  const up = (p: Partial<FiguraConfig>) => doc.updateFigura(p)

  const exportAvatar = async () => {
    const meta = avatarMeta(doc)
    const { files } = await buildAvatar(doc, meta)
    const dir = await storage.exportFigura(meta.name, files)
    if (dir) toast(t('figura.exported', { dir }))
  }
  const [merging, setMerging] = useState(false)

  return (
    <div className="panel-scroll">
      {!preview && <div className="section"><span className="muted" style={{ fontSize: 12 }}>{t('figura.previewOff')}</span><button className="btn" onClick={() => set({ figura: true })}><Icon name="sparkle" />Preview</button></div>}
      <SizeMeter doc={doc} />
      <div className="section">
        <span className="muted">{t('hair.motion')}</span>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {MOTION_MODES.map((m) => (
            <button key={m} className={motion === m ? 'on' : ''} disabled={!preview && m !== 'off'} onClick={() => set({ motion: m })}>{t(`hair.motions.${m}`)}</button>
          ))}
        </div>
      </div>

      <div className="section">
        <span className="label">{t('figura.head')}</span>
        <Toggle label={t('figura.smoothHead')} on={c.smoothHead} onChange={(v) => up({ smoothHead: v })}>
          <Range label={t('figura.headSpeed')} value={c.headSpeed} min={0.05} max={1} step={0.05} fmt={(v) => Math.round(v * 100) + '%'} onChange={(v) => up({ headSpeed: v })} />
        </Toggle>
        <Toggle label={t('figura.hairPhysics')} on={c.hairPhysics} onChange={(v) => up({ hairPhysics: v })}>
          <label className="row muted" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={c.swingAxis === -1} onChange={(e) => up({ swingAxis: e.target.checked ? -1 : 1 })} />
            {t('figura.swingFlip')}
          </label>
        </Toggle>
      </div>

      <div className="section">
        <span className="label">{t('figura.eyes')}</span>
        <Toggle label={t('figura.blink')} on={c.blink} onChange={(v) => up({ blink: v })}>
          <Range label={t('figura.blinkEvery')} value={c.blinkMax} min={1} max={12} step={0.5} fmt={(v) => `${c.blinkMin}–${v}`} onChange={(v) => up({ blinkMax: v, blinkMin: Math.min(c.blinkMin, v) })} />
        </Toggle>
        <Toggle label={t('figura.smoothEyes')} on={c.smoothEyes} onChange={(v) => up({ smoothEyes: v })}>
          <Range label={t('figura.eyeShift')} value={c.eyeShift} min={1} max={Math.max(2, doc.res / 32)} step={1} onChange={(v) => up({ eyeShift: v })} />
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
        </Toggle>
        <Toggle label={t('figura.talk')} on={c.talk} onChange={(v) => up({ talk: v })}>
          <span className="muted" style={{ fontSize: 11 }}>{t('figura.talkHelp')}</span>
          <Range label={t('figura.talkThreshold')} value={c.talkThreshold} min={0} max={0.5} step={0.01} onChange={(v) => up({ talkThreshold: v })} />
          <button className={'btn sm-btn' + (figTalk ? ' primary' : '')} disabled={!doc.faces.talk} onClick={() => set({ figTalk: !figTalk })}>
            {t('figura.testTalk')}
          </button>
        </Toggle>
      </div>

      <div className="section">
        <div className="prop-grid">
          <span className="muted">{t('figura.ears')}</span>
          <select className="select" value={c.ears} onChange={(e) => up({ ears: e.target.value as EarType })}>
            {TYPES.map((x) => <option key={x} value={x}>{t(`figura.types.${x}`)}</option>)}
          </select>
          <span className="muted">{t('figura.tail')}</span>
          <select className="select" value={c.tail} onChange={(e) => up({ tail: e.target.value as TailType })}>
            {TYPES.map((x) => <option key={x} value={x}>{t(`figura.types.${x}`)}</option>)}
          </select>
          {(c.ears !== 'none' || c.tail !== 'none') && (
            <>
              <span className="muted">{t('figura.fur')}</span>
              <div className="row">
                <input type="color" value={c.furColor} onChange={(e) => up({ furColor: e.target.value })} />
                <span className="muted">{t('figura.inner')}</span>
                <input type="color" value={c.furInner} onChange={(e) => up({ furInner: e.target.value })} />
              </div>
            </>
          )}
        </div>
        {c.tail !== 'none' && c.tail !== 'bunny' && (
          <label className="row muted" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={c.extrasPhysics} onChange={(e) => up({ extrasPhysics: e.target.checked })} />
            {t('figura.extrasPhysics')}
          </label>
        )}
      </div>

      <div className="section">
        <span className="label">{t('figura.hideVanilla')}</span>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          <button className={c.hideVanilla === 'used' ? 'on' : ''} onClick={() => up({ hideVanilla: 'used' })}>{t('figura.hideUsed')}</button>
          <button className={c.hideVanilla === 'all' ? 'on' : ''} onClick={() => up({ hideVanilla: 'all' })}>{t('figura.hideAll')}</button>
        </div>
        <span className="label" style={{ marginTop: 6 }}>{t('figura.info')}</span>
        <input className="input" placeholder={toEnglish(doc.name) || 'My Avatar'} value={c.avatarName} onChange={(e) => up({ avatarName: e.target.value })} />
        <input className="input" placeholder={t('figura.author')} value={c.author} onChange={(e) => up({ author: e.target.value })} />
        <input className="input" placeholder={t('figura.description')} value={c.description} onChange={(e) => up({ description: e.target.value })} />
        <span className="muted" style={{ fontSize: 11 }}>{t('figura.englishOnly')}</span>
        <button className="btn primary" onClick={exportAvatar}><Icon name="download" />{t('figura.export')}</button>
        <button className="btn" onClick={() => setMerging(true)}><Icon name="merge" />{t('figura.merge')}</button>
      </div>
      {merging && <MergeWindow doc={doc} onClose={() => setMerging(false)} />}
    </div>
  )
}

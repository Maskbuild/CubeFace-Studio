import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditor } from '../../store/editor'
import { mirrorPose } from '../../pose/apply'
import { emoteLength, emoteToEmotecraft, poseToEmotecraft, sampleEmote, type Axis, type Bone, type BoneState } from '../../pose/emote'
import { usePoseClock, usePoseLibrary } from '../../pose/library'
import { storage } from '../../lib/storage'
import { canRedistribute } from '../../skin/rights'
import { Icon } from '../common/Icon'
import { promptBox, toast } from '../common/dialogs'

const BONE_LIST: Bone[] = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']
const D = 180 / Math.PI
const SHOT_SIZES = [512, 1024, 2048]

function AngleSlider({ label, value, min = -180, max = 180, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <label className="pose-slider">
      <span className="muted">{label}</span>
      <input type="range" min={min} max={max} step={1} value={Math.round(value)} onChange={(e) => onChange(Number(e.target.value))} />
      <input className="input num" type="number" value={Math.round(value * 10) / 10} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </label>
  )
}

/** Right panel in pose mode: playback, per-part sliders, save / export. */
export function PosePanel() {
  const { t } = useTranslation()
  const s = useEditor()
  const tick = usePoseClock((c) => c.tick)
  const lib = usePoseLibrary()
  const [shotSize, setShotSize] = useState(1024)
  const e = s.emote
  const bone = s.poseBone
  const cur: BoneState = (bone && s.pose[bone]) || {}

  const setAxis = (a: Axis, v: number) => {
    if (!bone) return
    const next = { ...cur, [a]: v }
    s.set({ pose: { ...s.pose, [bone]: next } })
  }
  const setDeg = (a: Axis) => (v: number) => setAxis(a, v / D)
  const author = s.doc?.figura.author || ''

  const exportJson = async () => {
    const name = e ? e.name : (await promptBox(t('pose.exportName'), 'My pose', t('common.ok'), t('common.cancel')))?.trim()
    if (!name) return
    const json = e ? emoteToEmotecraft(e) : poseToEmotecraft(s.pose, name, author)
    const safe = name.replace(/[^\w\- ]+/g, '').trim() || 'emote'
    const path = await storage.saveFile(new TextEncoder().encode(json), safe + '.json', 'json', 'Emotecraft emote')
    if (path) toast(t('pose.exported', { path }))
  }
  const savePose = async () => {
    const name = (await promptBox(t('pose.saveName'), t('pose.myPose'), t('common.save'), t('common.cancel')))?.trim()
    if (!name) return
    lib.savePose(name, s.pose)
    toast(t('pose.savedOk', { name }))
  }
  const saveImage = async () => {
    if (!s.poseShot) return
    const box = document.querySelector('.canvas3d') as HTMLElement | null
    const aspect = box ? box.clientWidth / Math.max(1, box.clientHeight) : 1
    const w = aspect >= 1 ? shotSize : Math.round(shotSize * aspect)
    const h = aspect >= 1 ? Math.round(shotSize / aspect) : shotSize
    const url = s.poseShot(w, h)
    const path = await storage.savePng(url, (s.doc?.name || 'pose') + (e ? '_' + e.name : '') + '.png')
    if (path) toast(t('pose.imageSaved', { path }))
  }

  return (
    <div className="panel pose-panel">
      {e && (
        <div className="section">
          <div className="section-head">
            <span className="label">{t('pose.playing')}</span>
            <button className="icon-btn sm" title={t('pose.stop')} onClick={() => s.set({ emote: null, emotePlaying: false })}><Icon name="x" size={14} /></button>
          </div>
          <b className="emote-title">{e.builtin ? t('pose.anims.' + e.name) : e.name}</b>
          {e.author && <span className="muted" style={{ fontSize: 12 }}>{t('pose.by', { author: e.author })}</span>}
          <div className="row">
            <button className="btn" onClick={() => s.set({ emotePlaying: !s.emotePlaying })}>
              <Icon name={s.emotePlaying ? 'pause' : 'play'} size={14} />
              {s.emotePlaying ? t('pose.pause') : t('pose.play')}
            </button>
            <select className="input sm" value={s.emoteSpeed} onChange={(ev) => s.set({ emoteSpeed: Number(ev.target.value) })}>
              {[0.25, 0.5, 1, 1.5, 2].map((v) => <option key={v} value={v}>{v}×</option>)}
            </select>
            <span className="muted" style={{ fontSize: 12 }}>{e.loop ? t('pose.loop') : t('pose.once')}</span>
          </div>
          <input
            type="range"
            min={0}
            max={emoteLength(e)}
            step={0.5}
            value={Math.min(tick, emoteLength(e))}
            onChange={(ev) => {
              usePoseClock.setState({ seek: Number(ev.target.value), tick: Number(ev.target.value) })
              s.set({ emotePlaying: false })
            }}
          />
          <span className="muted" style={{ fontSize: 12 }}>{(tick / 20).toFixed(2)} / {(emoteLength(e) / 20).toFixed(2)} s</span>
          <button className="btn" onClick={() => s.set({ pose: sampleEmote(e, tick), emote: null, emotePlaying: false })}>
            <Icon name="pin" size={14} />
            {t('pose.useFrame')}
          </button>
        </div>
      )}

      <div className="section">
        <span className="label">{t('pose.edit')}</span>
        {e ? (
          <span className="muted" style={{ fontSize: 12 }}>{t('pose.stopToEdit')}</span>
        ) : (
          <>
            <div className="pose-grid">
              {BONE_LIST.map((b) => (
                <button key={b} className={'pose-chip' + (bone === b ? ' on' : '')} onClick={() => s.set({ poseBone: bone === b ? null : b })}>{t('pose.bones.' + b)}</button>
              ))}
            </div>
            {!bone && <span className="muted" style={{ fontSize: 12 }}>{t('pose.pickHint')}</span>}
            {bone && (
              <div className="pose-sliders">
                <AngleSlider label={t('pose.pitch')} value={(cur.pitch ?? 0) * D} onChange={setDeg('pitch')} />
                <AngleSlider label={t('pose.yaw')} value={(cur.yaw ?? 0) * D} onChange={setDeg('yaw')} />
                <AngleSlider label={t('pose.roll')} value={(cur.roll ?? 0) * D} onChange={setDeg('roll')} />
                {bone !== 'head' && (
                  <>
                    <AngleSlider label={bone === 'body' ? t('pose.bendBody') : t('pose.bend')} value={(cur.bend ?? 0) * D} onChange={setDeg('bend')} />
                    <AngleSlider label={t('pose.bendDir')} value={(cur.axis ?? 0) * D} onChange={setDeg('axis')} />
                  </>
                )}
                {(['x', 'y', 'z'] as Axis[]).map((a) =>
                  bone === 'body' ? (
                    <AngleSlider key={a} label={t('pose.move_' + a) + ' (×0.01)'} min={-200} max={200} value={(cur[a] ?? 0) * 100} onChange={(v) => setAxis(a, v / 100)} />
                  ) : (
                    <AngleSlider key={a} label={t('pose.move_' + a) + ' (px)'} min={-16} max={16} value={cur[a] ?? 0} onChange={(v) => setAxis(a, v)} />
                  )
                )}
                <span className="muted" style={{ fontSize: 11 }}>{bone === 'body' ? t('pose.bodyHint') : t('pose.gizmoHint')}</span>
                <button className="btn sm-btn" onClick={() => s.set({ pose: Object.fromEntries(Object.entries(s.pose).filter(([k]) => k !== bone)) })}>{t('pose.resetPart')}</button>
              </div>
            )}
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <button className="btn sm-btn" onClick={() => s.set({ pose: mirrorPose(s.pose) })}><Icon name="mirror" size={13} />{t('pose.mirror')}</button>
              <button className="btn sm-btn" onClick={() => s.set({ pose: {}, poseBone: null })}><Icon name="reset" size={13} />{t('pose.resetAll')}</button>
            </div>
          </>
        )}
      </div>

      <div className="section">
        <span className="label">{t('pose.saveSection')}</span>
        {!e && <button className="btn" onClick={savePose}><Icon name="save" />{t('pose.savePose')}</button>}
        <button className="btn" onClick={exportJson} disabled={!!e && !e.builtin && !canRedistribute(e.rights)} title={e && !e.builtin && !canRedistribute(e.rights) ? t('rights.downloadBlocked') : ''}>
          <Icon name="download" />
          {e ? t('pose.exportEmote') : t('pose.exportPose')}
        </button>
        <div className="row">
          <button className="btn grow" onClick={saveImage} disabled={!s.poseShot}><Icon name="image" />{t('pose.saveImage')}</button>
          <select className="input sm" value={shotSize} onChange={(ev) => setShotSize(Number(ev.target.value))}>
            {SHOT_SIZES.map((v) => <option key={v} value={v}>{v}px</option>)}
          </select>
        </div>
        <span className="muted" style={{ fontSize: 11 }}>{t('pose.imageHint')}</span>
      </div>
    </div>
  )
}

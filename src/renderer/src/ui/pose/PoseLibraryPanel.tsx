import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditor } from '../../store/editor'
import { BUILTIN_ANIMS, BUILTIN_POSES } from '../../pose/presets'
import { pickEmoteFiles, readEmoteFiles, usePoseLibrary } from '../../pose/library'
import type { Emote } from '../../pose/emote'
import { Icon } from '../common/Icon'
import { EmoteImportDialog } from './EmoteImportDialog'
import { confirmBox, toast } from '../common/dialogs'

/** Left panel in pose mode: poses to apply, built-in animations and the emote library. */
export function PoseLibraryPanel() {
  const { t } = useTranslation()
  const s = useEditor()
  const lib = usePoseLibrary()
  const [tab, setTab] = useState<'poses' | 'anims'>('poses')
  const [q, setQ] = useState('')
  const [queue, setQueue] = useState<Emote[]>([])
  useEffect(() => void lib.load(), [])

  const play = (e: Emote) => s.set({ emote: e, emotePlaying: true, poseBone: null })
  const importFiles = async (files: File[]) => {
    const { emotes, failed } = await readEmoteFiles(files)
    if (emotes.length) setQueue((q) => [...q, ...emotes])
    if (failed.length) toast(t('pose.failed', { list: failed.join('; ') }))
  }
  const match = (name: string) => !q.trim() || name.toLowerCase().includes(q.trim().toLowerCase())

  return (
    <div
      className="panel pose-lib"
      onDragOver={(e) => [...e.dataTransfer.types].includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        importFiles([...e.dataTransfer.files])
      }}
    >
      <div className="seg" style={{ display: 'flex' }}>
        <button className={tab === 'poses' ? 'on' : ''} style={{ flex: 1 }} onClick={() => setTab('poses')}>{t('pose.tabPoses')}</button>
        <button className={tab === 'anims' ? 'on' : ''} style={{ flex: 1 }} onClick={() => setTab('anims')}>{t('pose.tabAnims')}</button>
      </div>

      {tab === 'poses' && (
        <>
          <span className="label">{t('pose.builtin')}</span>
          <div className="pose-grid">
            {BUILTIN_POSES.map((p) => (
              <button key={p.id} className="pose-chip" onClick={() => s.set({ pose: structuredClone(p.pose), emote: null, emotePlaying: false })}>{t('pose.presets.' + p.name)}</button>
            ))}
          </div>
          <span className="label">{t('pose.saved')}</span>
          {lib.poses.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('pose.savedEmpty')}</span>}
          <div className="pose-grid">
            {lib.poses.map((p) => (
              <span key={p.id} className="pose-chip own">
                <button onClick={() => s.set({ pose: structuredClone(p.pose), emote: null, emotePlaying: false })}>{p.name}</button>
                <button
                  className="x"
                  title={t('common.delete')}
                  onClick={async () => (await confirmBox(t('pose.deletePose', { name: p.name }), t('common.delete'), t('common.cancel'), true)) && lib.removePose(p.id)}
                >
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
        </>
      )}

      {tab === 'anims' && (
        <>
          <span className="label">{t('pose.builtinAnims')}</span>
          <div className="pose-grid">
            {BUILTIN_ANIMS.map((e) => (
              <button key={e.id} className={'pose-chip' + (s.emote?.id === e.id ? ' on' : '')} onClick={() => play(e)}>{t('pose.anims.' + e.name)}</button>
            ))}
          </div>
          <div className="section-head">
            <span className="label">{t('pose.emotes')}</span>
            <button className="btn sm-btn" onClick={async () => importFiles(await pickEmoteFiles())}><Icon name="plus" size={13} />{t('pose.import')}</button>
          </div>
          <input className="input" placeholder={t('pose.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          {lib.emotes.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('pose.emotesEmpty')}</span>}
          <div className="emote-list">
            {lib.emotes.filter((e) => match(e.name) || match(e.author)).map((e) => (
              <button key={e.id} className={'emote-row' + (s.emote?.id === e.id ? ' on' : '')} onClick={() => play(e)} title={e.description}>
                {e.icon ? <img src={e.icon} alt="" /> : <span className="emote-ph"><Icon name="play" size={14} /></span>}
                <span className="grow">
                  <b>{e.name}</b>
                  <span className="muted">{[e.author, (e.endTick / 20).toFixed(1) + 's', e.loop ? '∞' : ''].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            ))}
          </div>
          <span className="muted" style={{ fontSize: 11 }}>{t('pose.dropHint')}</span>
        </>
      )}
      {queue[0] && (
        <EmoteImportDialog
          key={queue[0].id}
          queue={queue}
          onClose={() => setQueue([])}
          onAdd={(list) => {
            if (list.length) lib.addEmotes(list)
            setQueue((x) => x.slice(Math.max(1, list.length)))
          }}
        />
      )}
    </div>
  )
}

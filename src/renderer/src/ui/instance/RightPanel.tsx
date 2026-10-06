import { useTranslation } from 'react-i18next'
import { paletteFromImage } from '../../lib/paletteImport'
import { parseHex, toHex } from '../../skin/color'
import { PARTS } from '../../skin/layout'
import { allPalettes, useEditor } from '../../store/editor'
import { storage } from '../../lib/storage'
import { Icon } from '../common/Icon'
import { useState } from 'react'
import type { SkinDoc } from '../../skin/doc'
import { ColorPicker } from './ColorPicker'
import { HairPanel } from './HairPanel'
import { WardrobeWindow } from '../wardrobe/Wardrobe'

function PalettePanel() {
  const { t } = useTranslation()
  const { palettes, paletteId, color, recent, set, savePalettes } = useEditor()
  const list = allPalettes(palettes)
  const pal = list.find((p) => p.id === paletteId) ?? list[0]
  const pick = (hex: string) => {
    const c = parseHex(hex)
    if (c) set({ color: c })
  }
  const choose = (id: string) => {
    set({ paletteId: id })
    storage.setGlobal('paletteId', id)
  }

  return (
    <div className="section">
      <div className="section-head">
        <span className="label">{t('color.palette')}</span>
        <button
          className="icon-btn sm"
          title={t('color.importPalette')}
          onClick={async () => {
            const p = await paletteFromImage(16)
            if (!p) return
            savePalettes([...palettes, p])
            choose(p.id)
          }}
        >
          <Icon name="image" size={14} />
        </button>
      </div>
      <select className="select" value={pal.id} onChange={(e) => choose(e.target.value)}>
        {list.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <div className="swatches">
        {pal.colors.map((c, i) => (
          <button
            key={i}
            className="swatch"
            style={{ background: c }}
            title={pal.builtin ? c : `${c} — ${t('color.removeHint')}`}
            onClick={() => pick(c)}
            onContextMenu={(e) => {
              e.preventDefault()
              if (!pal.builtin) savePalettes(palettes.map((p) => (p.id === pal.id ? { ...p, colors: p.colors.filter((_, j) => j !== i) } : p)))
            }}
          />
        ))}
        {!pal.builtin && (
          <button
            className="swatch add"
            title={t('color.addToPalette')}
            onClick={() => savePalettes(palettes.map((p) => (p.id === pal.id ? { ...p, colors: [...p.colors, toHex(color, false)] } : p)))}
          >
            <Icon name="plus" size={12} />
          </button>
        )}
      </div>
      {recent.length > 0 && (
        <>
          <span className="label">{t('color.history')}</span>
          <div className="swatches">
            {recent.map((c) => (
              <button key={c} className="swatch" style={{ background: c }} title={c} onClick={() => pick(c)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ModelParts() {
  const { t } = useTranslation()
  const { hidden, toggleHidden, set } = useEditor()
  const allOverlayHidden = PARTS.every((p) => hidden[`${p}.overlay`])
  const eye = (key: string) => (
    <button className={'icon-btn sm'} style={{ justifySelf: 'center' }} onClick={() => toggleHidden(key)} title={key}>
      <Icon name={hidden[key] ? 'eyeOff' : 'eye'} size={14} />
    </button>
  )
  return (
    <div className="section">
      <div className="section-head">
        <span className="label">{t('parts.title')}</span>
        <label className="row muted" style={{ fontSize: 12 }}>
          <input
            type="checkbox"
            checked={!allOverlayHidden}
            onChange={() => set({ hidden: { ...hidden, ...Object.fromEntries(PARTS.map((p) => [`${p}.overlay`, !allOverlayHidden])) } })}
          />
          {t('parts.allOverlay')}
        </label>
      </div>
      <div className="parts">
        <span />
        <span className="ph">{t('parts.base')}</span>
        <span className="ph">{t('parts.overlay')}</span>
        {PARTS.map((p) => (
          <div key={p} style={{ display: 'contents' }}>
            <span>{t(`parts.${p}`)}</span>
            {eye(`${p}.base`)}
            {eye(`${p}.overlay`)}
          </div>
        ))}
      </div>
    </div>
  )
}

function Extras({ onWardrobe }: { onWardrobe: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="section">
      <button className="btn extra-btn" onClick={onWardrobe}>
        <Icon name="shirt" />
        {t('wardrobe.open')}
      </button>
    </div>
  )
}

export function RightPanel({ doc }: { doc: SkinDoc }) {
  const [wardrobe, setWardrobe] = useState(false)
  return (
    <div className="panel-scroll">
      <Extras onWardrobe={() => setWardrobe(true)} />
      <ColorPicker />
      <PalettePanel />
      <ModelParts />
      <HairPanel doc={doc} />
      {wardrobe && <WardrobeWindow doc={doc} onClose={() => setWardrobe(false)} />}
    </div>
  )
}

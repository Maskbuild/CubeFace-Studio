import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { paletteFromDataUrl, paletteFromImage } from '../../lib/paletteImport'
import { readDroppedImages } from '../../lib/files'
import { newId } from '../../skin/doc'
import { BUILTIN_PALETTES } from '../../skin/palette'
import { useEditor } from '../../store/editor'
import { confirmBox } from '../common/dialogs'
import { Icon } from '../common/Icon'

/** Global palettes: shared by every skin, editable from the Home screen. */
export function PaletteManager() {
  const { t } = useTranslation()
  const { palettes, savePalettes } = useEditor()

  const update = (id: string, p: Partial<(typeof palettes)[number]>) => savePalettes(palettes.map((x) => (x.id === id ? { ...x, ...p } : x)))
  const [over, setOver] = useState(false)

  return (
    <div
      className={'palette-list drop-zone' + (over ? ' over' : '')}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={async (e) => {
        e.preventDefault()
        setOver(false)
        // every dropped picture becomes a palette of its main colours
        const made = []
        for (const f of await readDroppedImages(e.dataTransfer.files)) {
          const p = await paletteFromDataUrl(f.name, f.dataUrl)
          if (p) made.push(p)
        }
        if (made.length) savePalettes([...palettes, ...made])
      }}
    >
      {over && <div className="drop-hint"><Icon name="image" size={28} />{t('color.dropHere')}</div>}
      <div className="row">
        <button className="btn primary" onClick={() => savePalettes([...palettes, { id: newId(), name: t('color.newPalette'), colors: [] }])}><Icon name="plus" />{t('color.newPalette')}</button>
        <button
          className="btn"
          onClick={async () => {
            const p = await paletteFromImage(16)
            if (p) savePalettes([...palettes, p])
          }}
        >
          <Icon name="image" />{t('color.importPalette')}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>{t('color.removeHint')}</span>
      </div>
      {palettes.map((p) => (
        <div key={p.id} className="palette-row">
          <div className="row" style={{ marginBottom: 10 }}>
            <input className="input grow" value={p.name} onChange={(e) => update(p.id, { name: e.target.value })} />
            <label className="btn" title={t('color.addToPalette')}>
              <Icon name="plus" />
              <input type="color" style={{ width: 0, height: 0, opacity: 0, border: 0, padding: 0 }} onChange={(e) => update(p.id, { colors: [...p.colors, e.target.value] })} />
            </label>
            <button
              className="icon-btn"
              title={t('common.delete')}
              onClick={async () => (await confirmBox(`${t('common.delete')} "${p.name}"?`, t('common.delete'), t('common.cancel'), true)) && savePalettes(palettes.filter((x) => x.id !== p.id))}
            >
              <Icon name="trash" />
            </button>
          </div>
          <div className="swatches">
            {p.colors.map((c, i) => (
              <button
                key={i}
                className="swatch"
                title={c}
                style={{ background: c }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  update(p.id, { colors: p.colors.filter((_, j) => j !== i) })
                }}
              />
            ))}
          </div>
        </div>
      ))}
      {BUILTIN_PALETTES.map((p) => (
        <div key={p.id} className="palette-row" style={{ opacity: 0.85 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <b>{p.name}</b>
            <span className="badge">built-in</span>
          </div>
          <div className="swatches">
            {p.colors.map((c) => (
              <span key={c} className="swatch" style={{ background: c }} title={c} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

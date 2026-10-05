import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { hsvToRgb, parseHex, rgbToHsv, toHex } from '../../skin/color'
import { useEditor } from '../../store/editor'

/** Drag helper: calls fn with the pointer position normalised to the element (0..1). */
function useDrag(fn: (x: number, y: number) => void) {
  return (e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect()
      fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)))
    }
    at(e)
    const move = (ev: PointerEvent) => at(ev)
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
}

export function ColorPicker() {
  const { t } = useTranslation()
  const color = useEditor((s) => s.color)
  const set = useEditor((s) => s.set)
  // keep hue/sat locally so they survive greys/black where RGB loses them
  const [hsv, setHsv] = useState(() => rgbToHsv(color[0], color[1], color[2]))
  const [hex, setHex] = useState(toHex(color))
  const svRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cur = hsvToRgb(...hsv).map(Math.round)
    if (cur[0] !== color[0] || cur[1] !== color[1] || cur[2] !== color[2]) {
      const n = rgbToHsv(color[0], color[1], color[2])
      setHsv([n[1] === 0 || n[2] === 0 ? hsv[0] : n[0], n[2] === 0 ? hsv[1] : n[1], n[2]])
    }
    setHex(toHex(color))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color])

  useEffect(() => {
    const c = svRef.current!
    c.width = 128
    c.height = 64
    const ctx = c.getContext('2d')!
    const [r, g, b] = hsvToRgb(hsv[0], 1, 1)
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(0, 0, 128, 64)
    const white = ctx.createLinearGradient(0, 0, 128, 0)
    white.addColorStop(0, '#fff')
    white.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = white
    ctx.fillRect(0, 0, 128, 64)
    const black = ctx.createLinearGradient(0, 0, 0, 64)
    black.addColorStop(0, 'rgba(0,0,0,0)')
    black.addColorStop(1, '#000')
    ctx.fillStyle = black
    ctx.fillRect(0, 0, 128, 64)
  }, [hsv[0]])

  const commit = (h: number, s: number, v: number, a = color[3]) => {
    setHsv([h, s, v])
    const [r, g, b] = hsvToRgb(h, s, v).map(Math.round)
    set({ color: [r, g, b, a] })
  }

  const onSV = useDrag((x, y) => commit(hsv[0], x, 1 - y))
  const onHue = useDrag((x) => commit(x * 359.9, hsv[1], hsv[2]))
  const onAlpha = useDrag((x) => set({ color: [color[0], color[1], color[2], Math.round(x * 255)] }))
  const rgb = `rgb(${color[0]},${color[1]},${color[2]})`

  return (
    <div className="section">
      <span className="label">{t('color.title')}</span>
      <div className="picker-sv" onPointerDown={onSV}>
        <canvas ref={svRef} />
        <div className="picker-knob" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: rgb }} />
      </div>
      <div className="hue" onPointerDown={onHue}>
        <div className="bar-knob" style={{ left: `${(hsv[0] / 360) * 100}%` }} />
      </div>
      <div className="alpha checker" onPointerDown={onAlpha}>
        <div className="fill" style={{ background: `linear-gradient(90deg, transparent, ${rgb})` }} />
        <div className="bar-knob" style={{ left: `${(color[3] / 255) * 100}%` }} />
      </div>
      <div className="row">
        <div className="swatch-big checker">
          <div style={{ background: `rgba(${color[0]},${color[1]},${color[2]},${color[3] / 255})` }} />
        </div>
        <label className="field grow" style={{ gap: 3 }}>
          <span className="label">{t('color.hex')}</span>
          <input
            className="input"
            value={hex}
            spellCheck={false}
            onChange={(e) => {
              setHex(e.target.value)
              const c = parseHex(e.target.value)
              if (c) set({ color: c })
            }}
            onBlur={() => setHex(toHex(color))}
          />
        </label>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'

/**
 * The number next to a slider: click it to type a value (Enter applies, Esc cancels).
 * Percentages are typed as percent ("35" for 35%); `scale` says how the shown number relates to
 * the value (shown = value * scale), guessed from a trailing "%" when not given.
 */
export function ValueField({ value, display, min, max, step, scale, onChange }: { value: number; display?: string; min: number; max: number; step?: number; scale?: number; onChange: (v: number) => void }) {
  const shown = display ?? String(value)
  const k = scale ?? (shown.trim().endsWith('%') ? 100 : 1)
  const [edit, setEdit] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (edit !== null) ref.current?.select()
  }, [edit !== null])
  const commit = () => {
    if (edit === null) return
    const n = Number(edit.replace(/[^\d.\-]/g, ''))
    setEdit(null)
    if (!edit.trim() || !Number.isFinite(n)) return
    let v = Math.min(max, Math.max(min, n / k))
    // typed values are kept as typed; only whole-number fields (size…) are rounded
    if (step && step >= 1) v = Math.round(v / step) * step
    // drop float noise from the step rounding
    onChange(Number(v.toFixed(6)))
  }
  if (edit !== null)
    return (
      <input
        ref={ref}
        className="val val-input"
        value={edit}
        inputMode="decimal"
        onChange={(e) => setEdit(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation() // tool shortcuts (B, E, [ ]…) must not fire while typing
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEdit(null)
        }}
      />
    )
  return (
    <button type="button" className="val val-btn" title="Click to type a value" onClick={(e) => (e.preventDefault(), setEdit(String(Math.round(value * k * 1000) / 1000)))}>
      {shown}
    </button>
  )
}

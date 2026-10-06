import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Details card shown next to a hovered item. Rendered at the page root: inside a card that
 * moves on hover (transform), a fixed-position child would be placed relative to the card
 * instead of the window. It sits right of the anchor, or left when there is no room, and is
 * kept inside the window using its real size.
 */
export function HoverTip({ anchor, children }: { anchor: DOMRect; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth, h = el.offsetHeight, gap = 8, m = 8
    const W = window.innerWidth, H = window.innerHeight
    const x = anchor.right + gap + w <= W - m ? anchor.right + gap : Math.max(m, anchor.left - gap - w)
    const y = Math.max(m, Math.min(anchor.top, H - h - m))
    setPos({ x, y })
  }, [anchor])
  return createPortal(
    <div ref={ref} className="item-tip" style={{ left: pos?.x ?? -9999, top: pos?.y ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
      {children}
    </div>,
    document.body
  )
}

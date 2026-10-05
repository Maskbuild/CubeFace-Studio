import type { EarType, TailType } from './figura'

type V3 = [number, number, number]

export interface ExtraBox {
  min: V3 // relative to the segment pivot, app model space (front +Z, player's right -X)
  size: V3
  color: 'fur' | 'inner'
}

/** A chain of segments; each segment's pivot sits at the previous segment's `next` point. */
export interface ExtraPart {
  id: string
  attach: 'head' | 'body'
  pivot: V3 // in the attached part's joint space (head: neck at origin; body: shoulders at origin)
  rest: V3 // degrees
  segments: { boxes: ExtraBox[]; next: V3 }[]
  physics: boolean
}

function ears(type: EarType): ExtraPart[] {
  if (type === 'none') return []
  const spec = {
    cat: { w: 3, h: 3, roll: 8 },
    fox: { w: 3, h: 4, roll: 12 },
    wolf: { w: 3, h: 3, roll: 18 },
    bunny: { w: 2, h: 6, roll: 6 }
  }[type]
  return ([-1, 1] as const).map((side) => ({
    id: side < 0 ? 'EarR' : 'EarL',
    attach: 'head' as const,
    pivot: [side * 2.5, 8, 0] as V3,
    rest: [0, 0, -side * spec.roll] as V3,
    physics: false,
    segments: [
      {
        boxes: [
          { min: [-spec.w / 2, 0, -0.5], size: [spec.w, spec.h, 1], color: 'fur' as const },
          { min: [-spec.w / 2 + 0.5, 0.5, 0.5], size: [spec.w - 1, spec.h - 1.5, 0.05], color: 'inner' as const }
        ],
        next: [0, spec.h, 0] as V3
      }
    ]
  }))
}

function tail(type: TailType): ExtraPart[] {
  if (type === 'none') return []
  const seg = (w: number, len: number, d: number, color: ExtraBox['color'] = 'fur') => ({
    boxes: [{ min: [-w / 2, -len, -d / 2] as V3, size: [w, len, d] as V3, color }],
    next: [0, -len, 0] as V3
  })
  const segments = {
    cat: [seg(1, 3, 1), seg(1, 3, 1), seg(1, 3, 1), seg(1, 3, 1)],
    wolf: [seg(2, 3, 2), seg(2.5, 3, 2.5), seg(2.5, 3, 2.5), seg(2, 2, 2)],
    fox: [seg(2, 2, 2), seg(3, 3, 3), seg(3.5, 3, 3.5), seg(2.5, 2, 2.5, 'inner')],
    bunny: [seg(2.5, 2.5, 2.5)]
  }[type]
  return [{ id: 'Tail', attach: 'body', pivot: [0, -10, -2], rest: [type === 'bunny' ? 80 : 50, 0, 0], physics: type !== 'bunny', segments }]
}

export function extraParts(e: EarType, t: TailType): ExtraPart[] {
  return [...ears(e), ...tail(t)]
}

import { describe, expect, it } from 'vitest'
import { cloneImg, createImg, fillRect, getPixel, Stroke } from '../src/renderer/src/skin/pixels'

describe('smooth brush', () => {
  it('mixes the brush colour with the colours already there', () => {
    const img = createImg(4, 4)
    fillRect(img, { x: 0, y: 0, w: 4, h: 4 }, [255, 0, 0, 255], 1)
    const paint = (mix: boolean) => {
      const t = cloneImg(img)
      const st = new Stroke(t, cloneImg(t), [0, 0, 255, 255], 1, 'paint')
      st.mix = mix
      st.cover(1, 1, 1)
      st.apply({ x: 1, y: 1, w: 1, h: 1 })
      return getPixel(t, 1, 1)
    }
    expect(paint(false)).toEqual([0, 0, 255, 255])
    const m = paint(true)
    expect(m[0]).toBeGreaterThan(50) // some of the red underneath stays
    expect(m[2]).toBeGreaterThan(100)
  })
})

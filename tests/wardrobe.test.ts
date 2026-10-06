import { describe, expect, it } from 'vitest'
import { applyAdjust } from '../src/renderer/src/skin/recolor'
import { composeLayers, type WardrobeItem } from '../src/renderer/src/skin/wardrobe'
import { createImg, getPixel } from '../src/renderer/src/skin/pixels'

const px = (r: number, g: number, b: number, a = 255) => {
  const img = createImg(1, 1)
  img.data.set([r, g, b, a])
  return img
}

describe('recolor', () => {
  it('shifts hue but keeps alpha and transparent pixels', () => {
    const out = applyAdjust(px(255, 0, 0, 200), { mode: 'hsv', hue: 120, sat: 1, light: 0 })
    expect(getPixel(out, 0, 0).map(Math.round)).toEqual([0, 255, 0, 200])
    expect(getPixel(applyAdjust(px(9, 9, 9, 0), { mode: 'hsv', hue: 50, sat: 1, light: 0 }), 0, 0)[3]).toBe(0)
  })

  it('gradient-maps by brightness', () => {
    const g = { mode: 'gradient' as const, dark: '#000080', light: '#ffff00', mix: 1 }
    expect(getPixel(applyAdjust(px(0, 0, 0), g), 0, 0)).toEqual([0, 0, 128, 255])
    expect(getPixel(applyAdjust(px(255, 255, 255), g), 0, 0)).toEqual([255, 255, 0, 255])
  })
})

describe('composeLayers', () => {
  const item = (category: WardrobeItem['category'], name: string): WardrobeItem => ({
    id: name, name, category, res: 64, variant: 'wide', credit: '', license: 'free', modifyPercent: 100, createdAt: 0, thumb: ''
  })
  it('stacks skin under clothes under the head and rescales', () => {
    const img = createImg(64, 64)
    const layers = composeLayers(
      [
        { item: item('head', 'H'), img, adjust: { mode: 'none' } },
        { item: item('skin', 'S'), img, adjust: { mode: 'none' } },
        { item: item('top', 'T'), img, adjust: { mode: 'none' } }
      ],
      128
    )
    expect(layers.map((l) => l.name)).toEqual(['S', 'T', 'H'])
    expect(layers[0].img.w).toBe(128)
    expect(layers[2].meta.source).toBe('wardrobe:H')
  })
})

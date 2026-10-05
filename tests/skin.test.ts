import { describe, expect, it } from 'vitest'
import { cuboids, faceAt, faceMap, RESOLUTIONS, type Variant } from '../src/renderer/src/skin/layout'
import { mirrorTexel } from '../src/renderer/src/skin/mirror'
import { brushKernel, composite, createImg, getPixel, resample } from '../src/renderer/src/skin/pixels'
import { SkinDoc } from '../src/renderer/src/skin/doc'
import { upgradeLegacy } from '../src/renderer/src/skin/templates'
import { parseHex, toHex, hsvToRgb, rgbToHsv } from '../src/renderer/src/skin/color'

const variants: Variant[] = ['wide', 'slim']

describe('layout', () => {
  it.each(variants)('faces never overlap (%s)', (v) => {
    const seen = new Int16Array(64 * 64)
    let total = 0
    for (const c of cuboids(v))
      for (const f of c.faces) {
        const { x, y, w, h } = f.rect
        expect(x + w).toBeLessThanOrEqual(64)
        expect(y + h).toBeLessThanOrEqual(64)
        for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) seen[py * 64 + px]++
        total += w * h
      }
    expect(Math.max(...seen)).toBe(1)
    expect([...faceMap(v)].filter((n) => n >= 0).length).toBe(total)
  })

  it('matches well-known coordinates', () => {
    const head = cuboids('wide').find((c) => c.key === 'head.base')!
    expect(head.faces.find((f) => f.name === 'front')!.rect).toEqual({ x: 8, y: 8, w: 8, h: 8 })
    const hat = cuboids('wide').find((c) => c.key === 'head.overlay')!
    expect(hat.faces.find((f) => f.name === 'back')!.rect).toEqual({ x: 56, y: 8, w: 8, h: 8 })
    const slimArm = cuboids('slim').find((c) => c.key === 'rightArm.base')!
    expect(slimArm.faces.find((f) => f.name === 'back')!.rect).toEqual({ x: 51, y: 20, w: 3, h: 12 })
  })

  it('scales face lookup with resolution', () => {
    for (const res of RESOLUTIONS) {
      const k = res / 64
      expect(faceAt('wide', res, 8 * k, 8 * k)).toEqual(faceAt('wide', 64, 8, 8))
      expect(faceAt('wide', res, 0, 0)).toBeNull()
    }
  })
})

describe('mirror', () => {
  it.each(variants)('is an involution on every used texel (%s)', (v) => {
    for (const res of [64, 128]) {
      for (let y = 0; y < res; y++)
        for (let x = 0; x < res; x++) {
          const m = mirrorTexel(v, res, x, y)
          if (!m) continue
          expect(mirrorTexel(v, res, m[0], m[1])).toEqual([x, y])
        }
    }
  })

  it('maps right arm front to left arm front, flipped', () => {
    // wide right arm front: x 44..47, y 20..31 ; left arm front: x 36..39, y 52..63
    expect(mirrorTexel('wide', 64, 44, 20)).toEqual([39, 52])
    // head front is its own mirror
    expect(mirrorTexel('wide', 64, 8, 8)).toEqual([15, 8])
    // head right side <-> head left side
    expect(mirrorTexel('wide', 64, 0, 8)).toEqual([23, 8])
  })
})

describe('pixels', () => {
  it('brush kernel is hard at softness 0 and sized correctly', () => {
    expect(brushKernel({ size: 1, softness: 0, shape: 'circle' }).a).toEqual(new Float32Array([1]))
    const k = brushKernel({ size: 3, softness: 0, shape: 'square' })
    expect([...k.a].every((v) => v === 1)).toBe(true)
    expect(k.off).toBe(-1)
    const soft = brushKernel({ size: 9, softness: 1, shape: 'circle' })
    expect(soft.a[4 * 9 + 4]).toBeCloseTo(1)
    expect(soft.a[4 * 9 + 8]).toBeLessThan(0.5)
  })

  it('composites with layer opacity', () => {
    const a = createImg(1, 1)
    a.data.set([255, 0, 0, 255])
    const b = createImg(1, 1)
    b.data.set([0, 0, 255, 255])
    const out = createImg(1, 1)
    composite([{ img: a, visible: true, opacity: 1 }, { img: b, visible: true, opacity: 0.5 }], out)
    const [r, g, bl, al] = getPixel(out, 0, 0)
    expect([Math.round(r), g, Math.round(bl), al]).toEqual([128, 0, 128, 255])
  })

  it('resamples up and back down losslessly', () => {
    const img = createImg(64, 64)
    for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 37) % 256 | (i % 4 === 3 ? 255 : 0)
    expect(resample(resample(img, 256), 64).data).toEqual(img.data)
  })
})

describe('SkinDoc', () => {
  const make = () => {
    const doc = new SkinDoc({ name: 't', res: 64, variant: 'wide' })
    doc.initLayers([doc.makeLayer('base')])
    return doc
  }

  it('paints a stroke without opacity build-up, and undoes it', () => {
    const doc = make()
    const s = doc.beginStroke([255, 0, 0, 255], 0.5, 'paint')!
    doc.stamp(s, 10, 10, { size: 1, softness: 0, shape: 'square' }, null, false)
    doc.stamp(s, 10, 10, { size: 1, softness: 0, shape: 'square' }, null, false)
    doc.endStroke(s)
    expect(Math.round(doc.pick(10, 10)[3])).toBe(128)
    doc.undo()
    expect(doc.pick(10, 10)[3]).toBe(0)
    doc.redo()
    expect(Math.round(doc.pick(10, 10)[3])).toBe(128)
  })

  it('mirrors strokes', () => {
    const doc = make()
    const s = doc.beginStroke([0, 255, 0, 255], 1, 'paint')!
    doc.stamp(s, 44, 20, { size: 1, softness: 0, shape: 'square' }, null, true)
    doc.endStroke(s)
    expect(doc.pick(39, 52)).toEqual([0, 255, 0, 255])
  })

  it('bucket face fills only that face; element fills the whole cuboid', () => {
    const doc = make()
    doc.fill(9, 9, 'face', [0, 0, 255, 255], 1, false, false)
    expect(doc.pick(8, 8)[3]).toBe(255)
    expect(doc.pick(15, 15)[3]).toBe(255)
    expect(doc.pick(7, 8)[3]).toBe(0) // head right side untouched
    doc.fill(9, 9, 'element', [0, 0, 255, 255], 1, false, false)
    expect(doc.pick(0, 8)[3]).toBe(255)
    expect(doc.pick(31, 15)[3]).toBe(255)
    expect(doc.pick(40, 8)[3]).toBe(0) // hat overlay untouched
  })

  it('changes resolution with undo', () => {
    const doc = make()
    doc.fill(9, 9, 'face', [0, 0, 255, 255], 1, false, false)
    doc.setResolution(256)
    expect(doc.res).toBe(256)
    expect(doc.pick(9 * 4, 9 * 4)).toEqual([0, 0, 255, 255])
    doc.undo()
    expect(doc.res).toBe(64)
    expect(doc.composite.w).toBe(64)
  })

  it('merges layers down', () => {
    const doc = make()
    doc.addLayer('top')
    doc.fill(9, 9, 'face', [255, 255, 0, 255], 1, false, false)
    doc.mergeDown(doc.activeId)
    expect(doc.layers.length).toBe(1)
    expect(doc.pick(9, 9)).toEqual([255, 255, 0, 255])
  })
})

describe('legacy + colour', () => {
  it('upgrades 64x32 skins by mirroring right limbs', () => {
    const old = createImg(64, 32)
    const i = (20 * 64 + 44) * 4 // right arm front top-left
    old.data.set([1, 2, 3, 255], i)
    expect(getPixel(upgradeLegacy(old), 39, 52)).toEqual([1, 2, 3, 255])
  })

  it('parses hex and round-trips hsv', () => {
    expect(parseHex('#f80')).toEqual([255, 136, 0, 255])
    expect(parseHex('#11223344')).toEqual([17, 34, 51, 68])
    expect(parseHex('zz')).toBeNull()
    expect(toHex([255, 136, 0, 255])).toBe('#ff8800')
    const [h, s, v] = rgbToHsv(40, 120, 200)
    expect(hsvToRgb(h, s, v).map(Math.round)).toEqual([40, 120, 200])
  })
})

describe('layer drag reorder', () => {
  it('moves a layer to an index with undo', () => {
    const doc = new SkinDoc({ name: 't', res: 64, variant: 'wide' })
    doc.initLayers([doc.makeLayer('a'), doc.makeLayer('b'), doc.makeLayer('c')])
    doc.moveLayerTo(doc.layers[2].id, 0)
    expect(doc.layers.map((l) => l.name)).toEqual(['c', 'a', 'b'])
    doc.undo()
    expect(doc.layers.map((l) => l.name)).toEqual(['a', 'b', 'c'])
  })
})

describe('layer import / clear', () => {
  it('replaces and clears pixels with undo', () => {
    const doc = new SkinDoc({ name: 't', res: 64, variant: 'wide' })
    doc.initLayers([doc.makeLayer('a')])
    const img = createImg(64, 64)
    img.data.set([9, 8, 7, 255], 0)
    doc.replaceLayerPixels(doc.activeId, img)
    expect(doc.pick(0, 0)).toEqual([9, 8, 7, 255])
    doc.replaceLayerPixels(doc.activeId, null)
    expect(doc.pick(0, 0)[3]).toBe(0)
    doc.undo()
    expect(doc.pick(0, 0)).toEqual([9, 8, 7, 255])
  })
})

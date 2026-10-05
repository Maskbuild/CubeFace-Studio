import { describe, expect, it } from 'vitest'
import { HairSim, LENGTH_PRESET, rescale, type Motion } from '../src/renderer/src/skin/hair'
import { createImg } from '../src/renderer/src/skin/pixels'

const still: Motion = { vx: 0, vy: 0, vz: 0, pitch: 0, yawRate: 0 }
const total = (sim: HairSim) => sim.out.reduce((a, b) => a + b, 0)

describe('HairSim', () => {
  it('rests at zero when the head is still', () => {
    const sim = new HairSim(3, 'back', { ...LENGTH_PRESET.medium.phys })
    for (let i = 0; i < 100; i++) sim.step(still)
    expect(Math.abs(total(sim))).toBeLessThan(1e-9)
  })

  it('back hair flows outward when walking forward and settles without blowing up', () => {
    const sim = new HairSim(5, 'back', { ...LENGTH_PRESET.long.phys })
    for (let i = 0; i < 200; i++) sim.step({ ...still, vz: 0.2 })
    const expected = 0.2 * LENGTH_PRESET.long.phys.drag
    expect(total(sim)).toBeCloseTo(expected, 2)
    for (let i = 0; i < 400; i++) sim.step(still)
    expect(Math.abs(total(sim))).toBeLessThan(1e-3)
  })

  it('front hair never swings into the face', () => {
    const phys = { ...LENGTH_PRESET.medium.phys }
    const sim = new HairSim(3, 'front', phys)
    for (let i = 0; i < 100; i++) {
      sim.step({ ...still, vz: 0.4 })
      expect(total(sim)).toBeGreaterThanOrEqual(-phys.limitIn * (Math.PI / 180) - 1e-9)
    }
  })

  it('interpolates between ticks', () => {
    const sim = new HairSim(2, 'back', { ...LENGTH_PRESET.short.phys })
    sim.step({ ...still, vz: 0.3 })
    const [a0] = sim.sample(0, 0)
    const [a1] = sim.sample(0, 1)
    const [ah] = sim.sample(0, 0.5)
    expect(ah).toBeCloseTo((a0 + a1) / 2)
  })
})

describe('rescale', () => {
  it('keeps pixels when doubling and halving', () => {
    const img = createImg(3, 2)
    img.data.set([1, 2, 3, 4], 4)
    const back = rescale(rescale(img, 6, 4), 3, 2)
    expect(back.data).toEqual(img.data)
  })
})

import { SkinDoc } from '../src/renderer/src/skin/doc'
import { getPixel } from '../src/renderer/src/skin/pixels'

describe('SkinDoc hair planes', () => {
  const make = () => {
    const doc = new SkinDoc({ name: 't', res: 128, variant: 'wide' })
    doc.initLayers([doc.makeLayer('base')])
    return doc
  }

  it('adds a plane with a texture sized to the resolution and undoes painting', () => {
    const doc = make()
    const h = doc.addHair('back', 'medium', 'Back')
    expect([h.img.w, h.img.h]).toEqual([16, 16])
    const s = doc.beginHairStroke(h.id, [255, 0, 0, 255], 1, 'paint')!
    doc.stamp(s, 3, 3, { size: 1, softness: 0, shape: 'square' }, null, true)
    doc.endStroke(s)
    expect(getPixel(doc.hairPlane(h.id)!.img, 3, 3)).toEqual([255, 0, 0, 255])
    expect(doc.pick(3, 3)[3]).toBe(0) // skin untouched
    doc.undo()
    expect(getPixel(doc.hairPlane(h.id)!.img, 3, 3)[3]).toBe(0)
  })

  it('keeps paint when resized and when the skin resolution changes', () => {
    const doc = make()
    const h = doc.addHair('front', 'short', 'Bangs')
    doc.fillHair(h.id, [0, 0, 255, 255], 1)
    doc.updateHair(h.id, { h: 8 })
    expect(doc.hairPlane(h.id)!.img.h).toBe(16)
    doc.setResolution(64)
    const img = doc.hairPlane(h.id)!.img
    expect([img.w, img.h]).toEqual([8, 8])
    expect(getPixel(img, 7, 7)).toEqual([0, 0, 255, 255])
    doc.undo()
    expect(doc.hairPlane(h.id)!.img.w).toBe(16)
  })

  it('serialises hair metadata without textures', () => {
    const doc = make()
    doc.addHair('back', 'long', 'Long')
    const json = doc.toJson()
    expect(json.hair).toHaveLength(1)
    expect('img' in json.hair![0]).toBe(false)
  })
})

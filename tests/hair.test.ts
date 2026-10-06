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

import { physFromFlow, criticalKeep } from '../src/renderer/src/skin/hair'

describe('smooth (bounce-free) physics', () => {
  it('critical damping has a double root', () => {
    for (const k of [0.05, 0.1, 0.2, 0.3]) {
      const c = criticalKeep(k)
      expect((1 + c - c * k) ** 2).toBeCloseTo(4 * c, 10)
    }
  })

  it.each([2, 3, 5, 8])('never overshoots when walking starts or stops (%i segments)', (segs) => {
    for (const flow of [0, 0.35, 0.55, 0.75, 1]) {
      const sim = new HairSim(segs, 'back', { ...physFromFlow(flow, 'long'), limitOut: 170 })
      const target = 0.2 * sim.phys.drag
      let peak = 0, low = Infinity
      for (let t = 0; t < 400; t++) {
        sim.step(t < 200 ? { ...still, vz: 0.2 } : still)
        const tot = sim.out.reduce((a, b) => a + b, 0)
        if (t < 200) peak = Math.max(peak, tot)
        else low = Math.min(low, tot)
      }
      expect(peak).toBeLessThanOrEqual(target * 1.0001)
      expect(low).toBeGreaterThanOrEqual(-1e-9) // no swing back past rest
    }
  })

  it('maps one smoothness value to all settings, defaults per length', () => {
    expect(LENGTH_PRESET.long.phys.flow).toBeGreaterThan(LENGTH_PRESET.short.phys.flow!)
    expect(physFromFlow(1, 'medium').stiffness).toBeLessThan(physFromFlow(0, 'medium').stiffness)
  })
})

import { rootWeight, HairSim as Sim2, physFromFlow as pf } from '../src/renderer/src/skin/hair'

describe('hair stays on the head', () => {
  it('the root swings much less than the tip, and the strand curves smoothly', () => {
    const sim = new Sim2(4, 'back', pf(0.55, 'medium'))
    for (let i = 0; i < 40; i++) sim.step({ vx: 0, vy: 0, vz: 0.28, pitch: 0, yawRate: 0 })
    const abs: number[] = []
    let sum = 0
    for (let i = 0; i < 4; i++) abs.push((sum += sim.sample(i, 1)[0]))
    expect(Math.abs(abs[0])).toBeLessThan(Math.abs(abs[3]) * 0.45)
    // each joint bends a little, no sharp kink
    for (let i = 1; i < 4; i++) expect(Math.abs(abs[i] - abs[i - 1])).toBeLessThan(Math.abs(abs[3]) * 0.6)
    expect(rootWeight(0, 4)).toBeCloseTo(0.3)
    expect(rootWeight(3, 4)).toBe(1)
  })
})

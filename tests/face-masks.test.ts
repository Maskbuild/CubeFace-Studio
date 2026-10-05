import { describe, expect, it } from 'vitest'
import { SkinDoc } from '../src/renderer/src/skin/doc'
import { autoMask, eyeParts, figuraDefaults, generateFrames, faceOrigin } from '../src/renderer/src/skin/figura'
import { createImg, fillRect, getPixel, type Img, type RGBA } from '../src/renderer/src/skin/pixels'

const SKIN: RGBA = [240, 200, 180, 255]
const WHITE: RGBA = [250, 250, 250, 255]
const BLUE: RGBA = [40, 90, 200, 255]
const BROW: RGBA = [60, 40, 30, 255]

/** 16x16 face (128px skin): eye boxes 4x2 with white sclera and a 2x2 blue iris, brows above. */
function face(): Img {
  const f = createImg(16, 16)
  fillRect(f, { x: 0, y: 0, w: 16, h: 16 }, SKIN, 1)
  for (const x0 of [2, 10]) {
    fillRect(f, { x: x0, y: 8, w: 4, h: 2 }, WHITE, 1)
    fillRect(f, { x: x0 + 1, y: 8, w: 2, h: 2 }, BLUE, 1)
    fillRect(f, { x: x0, y: 6, w: 4, h: 1 }, BROW, 1)
  }
  return f
}
const cfg = {
  ...figuraDefaults(128),
  eyeR: { x: 2, y: 8, w: 4, h: 2 },
  eyeL: { x: 10, y: 8, w: 4, h: 2 },
  browR: { x: 2, y: 5, w: 4, h: 3 },
  browL: { x: 10, y: 5, w: 4, h: 3 },
  mouth: { x: 6, y: 12, w: 4, h: 1 }
}
const on = (m: Img, x: number, y: number) => m.data[(y * m.w + x) * 4 + 3] > 127

describe('feature masks', () => {
  it('auto-selects the iris and the brow pixels', () => {
    const iris = autoMask(face(), cfg, 'eyeR')
    expect(on(iris, 3, 8) && on(iris, 4, 9)).toBe(true)
    expect(on(iris, 2, 8)).toBe(false) // sclera
    const brow = autoMask(face(), cfg, 'browR')
    expect([2, 3, 4, 5].every((x) => on(brow, x, 6))).toBe(true)
    expect(on(brow, 3, 5)).toBe(false) // skin above the brow
  })

  it('splits an eye into a moving iris and a base with sclera where the iris was', () => {
    const f = face()
    const mask = autoMask(f, cfg, 'eyeR')
    const { iris, base } = eyeParts(f, cfg.eyeR, mask, WHITE, 1)
    expect([iris.w, iris.h]).toEqual([6, 4])
    expect(getPixel(iris, 2, 1)).toEqual(BLUE)
    expect(getPixel(iris, 1, 1)[3]).toBe(0)
    expect(getPixel(base, 1, 0)).toEqual(WHITE) // iris replaced by sclera
    expect(getPixel(base, 0, 0)).toEqual(WHITE)
  })

  it('angry tilts the real brow: inner end goes down, original pixels erased', () => {
    const f = face()
    const masks = { browR: autoMask(f, cfg, 'browR'), browL: autoMask(f, cfg, 'browL') }
    const fr = generateFrames(f, cfg, masks)
    // right brow (viewer's left): inner end is x=5 -> moved down; outer end x=2 stays
    expect(getPixel(fr.angry, 2, 6)).toEqual(BROW)
    expect(getPixel(fr.angry, 5, 7)).toEqual(BROW)
    expect(getPixel(fr.angry, 5, 6)).toEqual(SKIN)
    // sad mirrors it: inner end goes up
    expect(getPixel(fr.sad, 5, 5)).toEqual(BROW)
    // blink covers the eye box with the cheek skin tone
    expect(getPixel(fr.blink, 2, 8)).toEqual(SKIN)
  })
})

describe('SkinDoc masks', () => {
  it('paints, auto-selects, undoes and rescales masks', () => {
    const doc = new SkinDoc({ name: 't', res: 64, variant: 'wide' })
    doc.initLayers([doc.makeLayer('a')])
    const s = doc.beginMaskStroke('eyeR', 'paint')
    doc.stamp(s, 1, 4, { size: 1, softness: 0, shape: 'square' }, null, false)
    doc.endStroke(s)
    expect(on(doc.masks.eyeR!, 1, 4)).toBe(true)
    doc.undo()
    expect(on(doc.masks.eyeR!, 1, 4)).toBe(false)
    doc.autoMask('browL')
    expect(doc.masks.browL).toBeDefined()
    doc.setResolution(128)
    expect(doc.masks.browL!.w).toBe(faceOrigin(128).size)
    expect(doc.toJson().masks).toEqual(expect.arrayContaining(['eyeR', 'browL']))
  })
})

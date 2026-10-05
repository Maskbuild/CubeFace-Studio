import { describe, expect, it } from 'vitest'
import { SkinDoc } from '../src/renderer/src/skin/doc'
import { FACE_FRAMES, figuraDefaults, irisImage } from '../src/renderer/src/skin/figura'
import { createImg, getPixel } from '../src/renderer/src/skin/pixels'
import { mannequin } from '../src/renderer/src/skin/templates'
import { extraParts } from '../src/renderer/src/skin/extras'

const make = (res = 64) => {
  const doc = new SkinDoc({ name: 't', res, variant: 'wide' })
  doc.initLayers([doc.makeLayer('base', mannequin(res, 'wide'))])
  return doc
}

describe('figura face frames', () => {
  it('generates every frame at face size, and undo removes them', () => {
    const doc = make(128)
    doc.generateFaces()
    for (const f of FACE_FRAMES) expect(doc.faces[f]?.w).toBe(16)
    // blink paints over the eye rect
    const e = doc.figura.eyeR
    expect(getPixel(doc.faces.blink!, e.x, e.y)[3]).toBe(255)
    doc.undo()
    expect(Object.keys(doc.faces)).toHaveLength(0)
  })

  it('mirrors strokes across the face centre', () => {
    const doc = make(64)
    doc.generateFaces(['shy'])
    const s = doc.beginFaceStroke('shy', [255, 0, 0, 255], 1, 'paint')!
    doc.stamp(s, 1, 2, { size: 1, softness: 0, shape: 'square' }, null, true)
    doc.endStroke(s)
    expect(getPixel(doc.faces.shy!, 6, 2)).toEqual([255, 0, 0, 255])
    doc.undo()
    expect(getPixel(doc.faces.shy!, 6, 2)[3]).toBe(0)
  })

  it('scales rects and frames with resolution', () => {
    const doc = make(64)
    doc.generateFaces(['blink'])
    doc.setResolution(256)
    expect(doc.figura.eyeR).toEqual({ x: 4, y: 16, w: 8, h: 4 })
    expect(doc.faces.blink!.w).toBe(32)
  })

  it('updates config with undo and serialises it', () => {
    const doc = make()
    doc.updateFigura({ ears: 'cat' })
    expect(doc.toJson().figura?.ears).toBe('cat')
    doc.undo()
    expect(doc.figura.ears).toBe('none')
  })
})

describe('figura helpers', () => {
  it('extracts the iris (non-sclera pixels) with padding', () => {
    const face = createImg(8, 8)
    face.data.set([255, 255, 255, 255], (4 * 8 + 1) * 4)
    face.data.set([20, 20, 60, 255], (4 * 8 + 2) * 4)
    const iris = irisImage(face, { x: 1, y: 4, w: 2, h: 1 }, [255, 255, 255, 255], 1)
    expect([iris.w, iris.h]).toEqual([4, 3])
    expect(getPixel(iris, 1, 1)[3]).toBe(0) // sclera dropped
    expect(getPixel(iris, 2, 1)).toEqual([20, 20, 60, 255])
  })

  it('builds ears and tails', () => {
    expect(extraParts('cat', 'fox').map((p) => p.id)).toEqual(['EarR', 'EarL', 'Tail'])
    expect(extraParts('none', 'none')).toEqual([])
    expect(figuraDefaults(64).mouth).toEqual({ x: 3, y: 6, w: 2, h: 1 })
  })
})

import { buildScript } from '../src/renderer/src/figura/script'
import luaparse from 'luaparse'

describe('custom expressions', () => {
  it('adds a blank frame, shows on the action wheel with an English title, undoes', () => {
    const doc = make(64)
    const c = doc.addCustomExpr('ยิ้มเยาะ Smirk', true)
    const key = `x_${c.id}` as const
    expect(doc.faces[key]?.w).toBe(8)
    expect(doc.faceFrame).toBe(key)
    const info = { hairChains: [], tailChain: null, faceParts: { [key]: 'F_' + key }, irisParts: [], replaces: [] }
    const s = buildScript('T', doc.figura, info, [])
    expect(s).toContain('title("Smirk")')
    expect(s).toContain(`${key} = true`) // covers eyes
    expect(() => luaparse.parse(s, { luaVersion: '5.2' })).not.toThrow()
    doc.undo()
    expect(doc.figura.customExpr).toHaveLength(0)
    expect(doc.faces[key]).toBeUndefined()
  })
})

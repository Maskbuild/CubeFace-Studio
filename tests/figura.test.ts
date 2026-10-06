import { describe, expect, it } from 'vitest'
import { SkinDoc } from '../src/renderer/src/skin/doc'
import { FACE_FRAMES, figuraDefaults } from '../src/renderer/src/skin/figura'
import { getPixel } from '../src/renderer/src/skin/pixels'
import { mannequin } from '../src/renderer/src/skin/templates'

const make = (res = 64) => {
  const doc = new SkinDoc({ name: 't', res, variant: 'wide' })
  doc.initLayers([doc.makeLayer('base', mannequin(res, 'wide'))])
  return doc
}

describe('figura face frames', () => {
  it('generates every frame at face size, and undo removes them', () => {
    const doc = make(128)
    doc.generateFaces()
    for (const f of FACE_FRAMES.filter((x) => x !== 'base')) expect(doc.faces[f]?.w).toBe(16)
    expect(doc.faces.base).toBeUndefined() // the base face is only made on request
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
    doc.updateFigura({ wheel: 'auria' })
    expect(doc.toJson().figura?.wheel).toBe('auria')
    doc.undo()
    expect(doc.figura.wheel).toBe('figura')
  })
})

describe('figura helpers', () => {
  it('has classic default boxes', () => {
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
    const info = { hairChains: [], faceParts: { [key]: 'F_' + key }, replaces: [], atlas: { w: 64, h: 64, slots: {} } }
    const s = buildScript('T', doc.figura, info, [])
    expect(s).toContain('title("Smirk")')
    expect(s).toContain('title("Expressions")') // reached from the main page
    expect(s).toContain(`${key} = true`) // covers eyes
    expect(() => luaparse.parse(s, { luaVersion: '5.2' })).not.toThrow()
    doc.undo()
    expect(doc.figura.customExpr).toHaveLength(0)
    expect(doc.faces[key]).toBeUndefined()
  })
})

describe('base face frame', () => {
  it('starts as an opaque copy of the face, so it fully replaces it', () => {
    const doc = make(64)
    doc.createBlankFace('base', true)
    const face = doc.faceImage()
    expect(doc.faces.base!.data).toEqual(face.data)
    expect(doc.faceFrame).toBe('base')
    doc.createBlankFace('happy')
    expect(doc.faces.happy!.data.every((v, i) => i % 4 !== 3 || v === 0)).toBe(true)
  })
})

import { prepareAtlas, shippedCuboids } from '../src/renderer/src/figura/avatar'
import { cuboids } from '../src/renderer/src/skin/layout'

describe('skin parts inside the avatar', () => {
  const partsOf = (doc: SkinDoc, t: 'figura' | 'bedrock') => [...new Set(cuboids('wide').filter((_, i) => shippedCuboids(doc, t)[i]).map((c) => c.part))]
  it('ships only the head, and only for the smooth head; Bedrock keeps everything', () => {
    const doc = make(64)
    expect(partsOf(doc, 'figura')).toEqual(['head'])
    doc.updateFigura({ smoothHead: false })
    expect(partsOf(doc, 'figura')).toEqual([]) // face frames ride on the vanilla head
    expect(prepareAtlas(doc, 'figura').atlas.img.h).toBeLessThan(64)
    expect(partsOf(doc, 'bedrock')).toHaveLength(6)
    doc.updateFigura({ skinParts: 'all' })
    expect(partsOf(doc, 'figura')).toHaveLength(6)
  })
})

import { buildModel } from '../src/renderer/src/figura/bbmodel'

describe('glowing parts', () => {
  it('builds a glow texture only from parts marked to glow, named skin_e for Figura', () => {
    const doc = make(64)
    doc.generateFaces()
    expect(prepareAtlas(doc, 'figura').glow).toBeNull()
    doc.updateFigura({ glowEyes: true })
    const { atlas, glow, frames } = prepareAtlas(doc, 'figura')
    expect(glow).not.toBeNull()
    const s = atlas.slots.eyes_glow
    // glowing pixels only inside the glowing-eyes slot
    let inside = 0, outside = 0
    for (let y = 0; y < glow!.h; y++)
      for (let x = 0; x < glow!.w; x++) {
        if (glow!.data[(y * glow!.w + x) * 4 + 3] === 0) continue
        if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) inside++
        else outside++
      }
    expect(inside).toBeGreaterThan(0)
    expect(outside).toBe(0)
    const { model } = buildModel({ name: 'T', variant: 'wide', res: 64, atlasW: atlas.img.w, atlasH: atlas.img.h, atlasDataUrl: 'data:image/png;base64,', glowDataUrl: 'data:image/png;base64,', slots: atlas.slots, hair: [], figura: doc.figura, faceFrames: frames }) as { model: { textures: { name: string }[] } }
    expect(model.textures.map((t) => t.name)).toEqual(['skin.png', 'skin_e.png'])
    expect(prepareAtlas(doc, 'bedrock').glow).toBeNull() // Bedrock has no glow layer
  })
  it('glowing layers only count where the shipped parts are', () => {
    const doc = make(64)
    doc.setLayerProps(doc.layers[0].id, { glow: true })
    doc.updateFigura({ smoothHead: false }) // nothing of the skin ships
    expect(prepareAtlas(doc, 'figura').glow).toBeNull()
    doc.updateFigura({ smoothHead: true }) // the head ships: its pixels glow
    expect(prepareAtlas(doc, 'figura').glow).not.toBeNull()
  })
})

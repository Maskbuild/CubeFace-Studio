import { describe, expect, it } from 'vitest'
import './_window'
import { SkinDoc } from '../src/renderer/src/skin/doc'
import { buildAtlas } from '../src/renderer/src/figura/atlas'
import { prepareAtlas } from '../src/renderer/src/figura/avatar'
import { buildModel } from '../src/renderer/src/figura/bbmodel'
import { createImg, fillRect, getPixel } from '../src/renderer/src/skin/pixels'
import { figuraDefaults } from '../src/renderer/src/skin/figura'

describe('face image size', () => {
  it('rescales frames and eye boxes and keeps them when the skin size changes', () => {
    const doc = new SkinDoc({ name: 'T', res: 64 })
    doc.generateFaces()
    const eye = doc.figura.eyeR
    expect(doc.faces.blink!.w).toBe(8)
    doc.setFaceRes(512)
    expect(doc.faceSize()).toBe(64)
    expect(doc.faces.blink!.w).toBe(64)
    expect(doc.faceImage().w).toBe(64)
    expect(doc.figura.eyeR).toEqual({ x: eye.x * 8, y: eye.y * 8, w: eye.w * 8, h: eye.h * 8 })
    doc.setResolution(128)
    expect(doc.faces.blink!.w).toBe(64)
    doc.setFaceRes(undefined)
    expect(doc.faces.blink!.w).toBe(16)
    expect(doc.figura.faceRes).toBeUndefined()
  })

  it('widens the atlas for detailed faces but keeps the skin texels in place', () => {
    const skin = createImg(64, 64)
    fillRect(skin, { x: 63, y: 10, w: 1, h: 1 }, [1, 2, 3, 255], 1)
    const { img, slots } = buildAtlas(skin, { face_base: createImg(128, 128) })
    expect(img.w).toBe(128)
    expect(getPixel(img, 63, 10)).toEqual([1, 2, 3, 255])
    expect(slots.face_base).toMatchObject({ x: 0, y: 64, w: 128 })
  })

  it('maps skin cubes onto the left part of a wider atlas', () => {
    const base = { name: 'T', variant: 'wide' as const, res: 64, atlasDataUrl: '', slots: {}, hair: [], figura: figuraDefaults(64), faceFrames: [] }
    const a = buildModel({ ...base, atlasW: 64, atlasH: 64 }).model as any
    const b = buildModel({ ...base, atlasW: 128, atlasH: 192, skinW: 64 }).model as any
    const head = (m: any) => m.elements.find((e: any) => e.name === 'Head').faces.north.uv
    expect(head(b)).toEqual(head(a).map((v: number) => v / 2))
  })

  it('shrinks detailed faces to the skin width for Bedrock', () => {
    const doc = new SkinDoc({ name: 'T', res: 64 })
    doc.generateFaces()
    doc.setFaceRes(1024)
    expect(prepareAtlas(doc, 'bedrock').atlas.img.w).toBe(64)
    expect(prepareAtlas(doc, 'figura').atlas.img.w).toBe(128)
  })
})

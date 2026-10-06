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
    const doc = new SkinDoc({ name: 'T', res: 64, variant: 'wide' })
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
    const doc = new SkinDoc({ name: 'T', res: 64, variant: 'wide' })
    doc.generateFaces()
    doc.setFaceRes(1024)
    expect(prepareAtlas(doc, 'bedrock').atlas.img.w).toBe(64)
    expect(prepareAtlas(doc, 'figura').atlas.img.w).toBe(128)
  })
})

describe('glow spots', () => {
  it('starts from the eye boxes and glows only the painted spots', async () => {
    const { eyesOnly } = await import('../src/renderer/src/figura/avatar')
    const doc = new SkinDoc({ name: 'T', res: 64, variant: 'wide' })
    doc.generateFaces()
    doc.updateFigura({ glowEyes: true })
    const before = eyesOnly(doc).data.filter((_, i) => i % 4 === 3 && _ > 0).length
    doc.ensureGlowMask()
    const mask = doc.faces.glowMask!
    expect(eyesOnly(doc).data.filter((_, i) => i % 4 === 3 && _ > 0).length).toBe(before)
    mask.data.fill(0)
    mask.data.set([255, 255, 255, 255], 0)
    const g = eyesOnly(doc)
    expect(g.data.filter((_, i) => i % 4 === 3 && _ > 0).length).toBeLessThanOrEqual(1)
  })
})

describe('face painted on the hat layer', () => {
  it('detects eyes on the hat and puts blink / expression frames in front of the hat', () => {
    const doc = new SkinDoc({ name: 'T', res: 64, variant: 'wide' })
    expect(doc.faceOnHat()).toBe(false)
    // paint the eye boxes on the hat (outer layer front of the head: x 40..48, y 8..16)
    for (const r of [doc.figura.eyeR, doc.figura.eyeL])
      fillRect(doc.composite, { x: 40 + r.x, y: 8 + r.y, w: r.w, h: r.h }, [20, 20, 30, 255], 1)
    expect(doc.faceOnHat()).toBe(true)
    // the reference face includes the hat's eyes
    expect(getPixel(doc.faceImage(), doc.figura.eyeR.x, doc.figura.eyeR.y)).toEqual([20, 20, 30, 255])
    const base = { name: 'T', variant: 'wide' as const, res: 64, atlasW: 64, atlasH: 96, atlasDataUrl: '', hair: [], figura: figuraDefaults(64), slots: { face_base: { x: 0, y: 64, w: 8, h: 8 }, face_blink: { x: 8, y: 64, w: 8, h: 8 } } }
    const on = buildModel({ ...base, faceFrames: ['base', 'blink'], faceOnHat: true }).model as any
    const off = buildModel({ ...base, faceFrames: ['base', 'blink'] }).model as any
    const el = (m: any, n: string) => m.elements.find((e: any) => e.name === n)
    expect(el(on, 'F_blink').from).toEqual([-4.5, 23.5, -4.521])
    expect(el(on, 'F_blink').to).toEqual([4.5, 32.5, -4.521])
    expect(el(on, 'F_base').from[2]).toBeCloseTo(-4.02) // the base frame stays on the face, under the hat
    expect(el(off, 'F_blink').from).toEqual([-4, 24, -4.021])
  })
})

import { attachedPos, hairAttached, hairDefaults } from '../src/renderer/src/skin/hair'
describe('hair attached to the head', () => {
  it('flags planes hanging from the neck or inside the head, and snaps them back', () => {
    const back = hairDefaults('back', 'long')
    expect(hairAttached(back)).toBe(true)
    expect(hairAttached(hairDefaults('front', 'short'))).toBe(true)
    const neck = { ...back, pos: [0, 0, -3] as [number, number, number] } // the in-game report
    expect(hairAttached(neck)).toBe(false)
    expect(attachedPos(neck)).toEqual([0, 8, -4.6])
    expect(hairAttached({ ...back, pos: [4.6, 7, 0] })).toBe(true) // on the side of the head
  })
})

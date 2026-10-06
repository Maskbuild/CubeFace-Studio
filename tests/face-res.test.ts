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

describe('no z-fighting in game', () => {
  it('flat planes have one face and face frames are far enough apart', () => {
    const slots = { face_base: { x: 0, y: 64, w: 8, h: 8 }, face_blink: { x: 8, y: 64, w: 8, h: 8 }, face_happy: { x: 16, y: 64, w: 8, h: 8 }, eyes_glow: { x: 24, y: 64, w: 8, h: 8 } }
    const m = buildModel({ name: 'T', variant: 'wide', res: 64, atlasW: 64, atlasH: 96, atlasDataUrl: '', hair: [], figura: figuraDefaults(64), slots, faceFrames: ['base', 'blink', 'happy'] }).model as any
    const planes = m.elements.filter((e: any) => e.from[2] === e.to[2])
    expect(planes.length).toBe(4)
    for (const p of planes) expect(p.faces.south.texture).toBeNull() // a back face at the same spot flickers
    const zs = planes.map((p: any) => p.from[2]).sort((a: number, b: number) => a - b)
    for (let i = 1; i < zs.length; i++) expect(zs[i] - zs[i - 1]).toBeGreaterThanOrEqual(0.0049)
  })
})

import { HairSim, MAX_ROLL, livePhys as livePhys2 } from '../src/renderer/src/skin/hair'
describe('hair stays in one piece', () => {
  it('turns sideways only at the root (no in-plane twist between segments)', () => {
    const h = hairDefaults('back', 'long')
    const sim = new HairSim(6, 'back', livePhys2(h.phys, true))
    for (let t = 0; t < 40; t++) sim.step({ vz: 0.2, vx: 0.4, vy: 0, pitch: 0.3, yawRate: 0.2 })
    for (let i = 1; i < 6; i++) expect(sim.sample(i, 1)[1]).toBe(0)
    const root = sim.sample(0, 1)[1]
    expect(root).not.toBe(0)
    expect(Math.abs(root)).toBeLessThanOrEqual(MAX_ROLL)
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

import { describe, expect, it } from 'vitest'
import luaparse from 'luaparse'
import { readFileSync } from 'node:fs'
import { buildModel, toBBRotation, type ModelInput } from '../src/renderer/src/figura/bbmodel'
import { buildScript } from '../src/renderer/src/figura/script'
import { buildAtlas } from '../src/renderer/src/figura/atlas'
import { figuraDefaults, FACE_FRAMES } from '../src/renderer/src/skin/figura'
import { hairDefaults } from '../src/renderer/src/skin/hair'
import { extraParts } from '../src/renderer/src/skin/extras'
import { createImg } from '../src/renderer/src/skin/pixels'

const hair = { ...hairDefaults('back', 'medium'), id: 'h1', name: 'Back' }
const input = (over: Partial<ModelInput> = {}): ModelInput => ({
  name: 'Test',
  variant: 'wide',
  res: 64,
  atlasW: 64,
  atlasH: 96,
  atlasDataUrl: 'data:image/png;base64,',
  slots: {
    hair_h1: { x: 0, y: 64, w: 8, h: 8 },
    face_blink: { x: 8, y: 64, w: 8, h: 8 },
    face_happy: { x: 16, y: 64, w: 8, h: 8 },
    iris_R: { x: 24, y: 64, w: 4, h: 3 },
    iris_L: { x: 28, y: 64, w: 4, h: 3 },
    fur: { x: 32, y: 64, w: 2, h: 2 },
    inner: { x: 34, y: 64, w: 2, h: 2 }
  },
  hair: [hair],
  figura: figuraDefaults(64),
  faceFrames: ['blink', 'happy'],
  iris: true,
  extras: extraParts('cat', 'fox'),
  ...over
})

type Any = Record<string, any>
const find = (m: Any, name: string) => m.elements.find((e: Any) => e.name === name)
const group = (m: Any, name: string) => m.groups.find((g: Any) => g.name === name)

describe('bbmodel writer', () => {
  const { model, info } = buildModel(input()) as { model: Any; info: any }

  it('matches the verified Figura head layout and UVs', () => {
    const head = find(model, 'Head')
    expect(head.from).toEqual([-4, 24, -4])
    expect(head.to).toEqual([4, 32, 4])
    expect(head.faces.north.uv).toEqual([8, 8, 16, 16])
    expect(head.faces.east.uv).toEqual([0, 8, 8, 16])
    expect(head.faces.west.uv).toEqual([16, 8, 24, 16])
    expect(head.faces.up.uv).toEqual([16, 8, 8, 0])
    expect(head.faces.down.uv).toEqual([24, 0, 16, 8])
    expect(find(model, 'Hat').inflate).toBe(0.5)
  })

  it('puts the right arm on +X like Figura', () => {
    expect(group(model, 'RightArm').origin).toEqual([5, 22, 0])
    const arm = find(model, 'RightArm')
    expect(arm.from).toEqual([4, 12, -2])
    expect(arm.faces.north.uv).toEqual([44, 20, 48, 32])
  })

  it('builds hair chains, face planes, irises and extras', () => {
    expect(info.hairChains[0].path).toEqual(['Hair1', 's1', 's2', 's3'])
    expect(info.faceParts).toEqual({ blink: 'F_blink', happy: 'F_happy' })
    expect(info.irisParts).toEqual(['IrisR', 'IrisL'])
    expect(info.tailChain).toEqual(['Tail', 's2', 's3', 's4'])
    // back hair rests behind the head (+Z in Blockbench)
    expect(group(model, 'Hair1').origin[2]).toBeCloseTo(4.6)
    // right iris sits on the +X half of the face
    const ir = find(model, 'IrisR')
    expect(ir.from[0]).toBeGreaterThan(0)
    expect(model.resolution).toEqual({ width: 64, height: 96 })
    // every outliner reference resolves
    const ids = new Set([...model.elements.map((e: Any) => e.uuid), ...model.groups.map((g: Any) => g.uuid)])
    const walk = (n: Any) => (typeof n === 'string' ? expect(ids.has(n)).toBe(true) : (expect(ids.has(n.uuid)).toBe(true), n.children.forEach(walk)))
    model.outliner.forEach(walk)
  })

  it('converts rotations', () => {
    const r = toBBRotation([20, 0, 0])
    expect(r).toEqual([-20, 0, 0])
    expect(toBBRotation([0, 30, 0])).toEqual([0, 30, 0])
  })
})

describe('script generator', () => {
  const cfg = { ...figuraDefaults(64), smoothEyes: true, ears: 'cat' as const, tail: 'fox' as const }
  const { info } = buildModel(input({ faceFrames: [...FACE_FRAMES] , slots: { ...input().slots, ...Object.fromEntries(FACE_FRAMES.map((f, i) => ['face_' + f, { x: i * 8, y: 72, w: 8, h: 8 }])) } }))
  const script = buildScript('Test', cfg, info, [hair])

  it('is valid Lua', () => {
    expect(() => luaparse.parse(script, { luaVersion: '5.2' })).not.toThrow()
    expect(() => luaparse.parse(readFileSync('src/figura/nkw_physics.lua', 'utf8'), { luaVersion: '5.2' })).not.toThrow()
  })

  it('wires physics, expressions, blink, talking and smooth head/eyes', () => {
    expect(script).toContain('phys.chain({ M.Head.Hair1.s1, M.Head.Hair1.s1.s2, M.Head.Hair1.s1.s2.s3 }')
    expect(script).toContain('M.Body.Tail, M.Body.Tail.s2')
    expect(script).toContain('function pings.nkwExpr(i)')
    expect(script).toContain('plasmovoice:getVoiceLevel(player:getUUID())')
    expect(script).toContain('vanilla_model.HEAD:getOriginRot()')
    expect(script).toContain('setUVPixels')
    expect(script).not.toMatch(/[\u0E00-\u0E7F]/) // English only
  })

  it('omits disabled features', () => {
    const s = buildScript('T', { ...cfg, smoothHead: false, smoothEyes: false, talk: false, blink: false, expressions: false, hairPhysics: false }, { ...info, tailChain: null }, [hair])
    expect(s).not.toContain('nkw_physics')
    expect(s).not.toContain('getOriginRot')
    expect(s).not.toContain('events.tick')
    expect(() => luaparse.parse(s, { luaVersion: '5.2' })).not.toThrow()
  })
})

describe('atlas', () => {
  it('appends extras below the skin without overlap', () => {
    const { img, slots } = buildAtlas(createImg(64, 64), { a: createImg(40, 8), b: createImg(30, 4), c: createImg(10, 8) })
    expect(img.w).toBe(64)
    expect(slots.a.y).toBe(64)
    const rects = Object.values(slots)
    for (const r of rects) for (const q of rects) if (r !== q) expect(r.x + r.w <= q.x || q.x + q.w <= r.x || r.y + r.h <= q.y || q.y + q.h <= r.y).toBe(true)
  })
})

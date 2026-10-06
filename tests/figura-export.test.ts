import { describe, expect, it } from 'vitest'
import luaparse from 'luaparse'
import { readFileSync } from 'node:fs'
import { buildModel, toBBRotation, type ModelInput } from '../src/renderer/src/figura/bbmodel'
import { auriaConf, buildScript } from '../src/renderer/src/figura/script'
import { buildAtlas } from '../src/renderer/src/figura/atlas'
import { DEFAULT_AURIA, figuraDefaults, FACE_FRAMES, itemView, liveWheel, migrateWheel, syncWheel } from '../src/renderer/src/skin/figura'
import { hairDefaults } from '../src/renderer/src/skin/hair'
import { createImg } from '../src/renderer/src/skin/pixels'

const hair = { ...hairDefaults('back', 'medium'), segments: 3, id: 'h1', name: 'Back' }
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
  },
  hair: [hair],
  figura: figuraDefaults(64),
  faceFrames: ['blink', 'happy'],
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

  it('builds hair chains and face planes', () => {
    expect(info.hairChains[0].path).toEqual(['Hair1', 's1', 's2', 's3'])
    expect(info.faceParts).toEqual({ blink: 'F_blink', happy: 'F_happy' })
    // back hair rests behind the head (+Z in Blockbench)
    expect(group(model, 'Hair1').origin[2]).toBeCloseTo(4.6)
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
  const cfg = { ...figuraDefaults(64) }
  const { info } = buildModel(input({ faceFrames: [...FACE_FRAMES] , slots: { ...input().slots, ...Object.fromEntries(FACE_FRAMES.map((f, i) => ['face_' + f, { x: i * 8, y: 72, w: 8, h: 8 }])) } }))
  const script = buildScript('Test', cfg, info, [hair])

  it('is valid Lua', () => {
    expect(() => luaparse.parse(script, { luaVersion: '5.2' })).not.toThrow()
    expect(() => luaparse.parse(readFileSync('src/figura/nkw_physics.lua', 'utf8'), { luaVersion: '5.2' })).not.toThrow()
  })

  it('wires physics, expressions, blink, talking and smooth head', () => {
    expect(script).toContain('phys.chain({ M.Head.Hair1.s1, M.Head.Hair1.s1.s2, M.Head.Hair1.s1.s2.s3 }')
    expect(script).toContain('function pings.nkwExpr(i)')
    expect(script).toContain('plasmovoice:getVoiceLevel(player:getUUID())')
    expect(script).toContain('vanilla_model.HEAD:getOriginRot()')
    expect(script).not.toMatch(/[\u0E00-\u0E7F]/) // English only
  })

  it('omits disabled features', () => {
    const s = buildScript('T', { ...cfg, smoothHead: false, talk: false, blink: false, expressions: false, hairPhysics: false }, info, [hair])
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

import { usedCuboids, usedHeight } from '../src/renderer/src/skin/usage'
import { cuboids, scaleRect } from '../src/renderer/src/skin/layout'
import { fillRect } from '../src/renderer/src/skin/pixels'

describe('head-only avatars', () => {
  const skin = createImg(128, 128)
  const head = cuboids('wide').find((c) => c.key === 'head.base')!
  fillRect(skin, scaleRect(head.faces[3].rect, 128), [200, 150, 120, 255], 1)
  const used = usedCuboids(skin, 'wide')

  it('detects used parts and crops the texture to the head rows', () => {
    expect(used.filter(Boolean)).toHaveLength(1)
    expect(usedHeight(skin, 'wide')).toBe(32) // 16 base px at 2x
  })

  it('exports only the head and hides only the vanilla head', () => {
    const { model, info } = buildModel(input({ used, hair: [], faceFrames: [] })) as { model: Any; info: any }
    expect(model.elements.map((e: Any) => e.name)).toEqual(['Head'])
    expect(model.outliner).toHaveLength(1)
    expect(model.groups.some((g: Any) => g.name === 'Body')).toBe(false)
    expect(info.replaces).toEqual(['HEAD', 'HAT'])
    const s = buildScript('T', { ...figuraDefaults(64), hideVanilla: 'used' }, info, [])
    expect(s).toContain('vanilla_model.HEAD:setVisible(false)')
    expect(s).not.toContain('vanilla_model.PLAYER')
    expect(s).not.toContain('BODY')
    expect(buildScript('T', { ...figuraDefaults(64), hideVanilla: 'all', skinParts: 'all' }, info, [])).toContain('vanilla_model.PLAYER:setVisible(false)')
    // with only the needed parts shipped, the rest of the vanilla player has to stay visible
    expect(buildScript('T', { ...figuraDefaults(64), hideVanilla: 'all' }, info, [])).not.toContain('vanilla_model.PLAYER')
  })
})

const ATLAS = { w: 64, h: 96, slots: { face_happy: { x: 16, y: 64, w: 8, h: 8 }, icon_img1: { x: 32, y: 64, w: 32, h: 32 } } }
const parse = (src: string) => expect(() => luaparse.parse(src, { luaVersion: '5.2' })).not.toThrow()

describe('action wheel pages', () => {
  const info = { hairChains: [{ path: ['Hair1', 's1'], id: 'h1' }], faceParts: { happy: 'F_happy', sad: 'F_sad', blink: 'F_blink' }, replaces: [], atlas: ATLAS }

  it('default wheel: main page opens the expressions page and toggles blinking / hair', () => {
    const s = buildScript('T', figuraDefaults(64), info, [hair])
    expect(s).toContain('P[1] = action_wheel:newPage("Main")')
    expect(s).toContain('P[1]:newAction():title("Expressions"):item("minecraft:painting"):onLeftClick(function() action_wheel:setPage(P[2]) end)')
    expect(s).toContain('title("Blinking"):item("minecraft:ender_eye"):setToggled(true):onToggle(function(on) pings.nkwToggle(1, on) end)')
    expect(s).toContain('title("Hair physics"):item("minecraft:feather"):setToggled(true):onToggle(function(on) pings.nkwToggle(2, on) end)')
    expect(s).toContain('local EXPR = { "happy", "sad" }') // only expressions with frames
    expect(s).toContain('title("Normal face")')
    expect(s).toContain('P[2]:newAction():title("Back"):item("minecraft:arrow"):onLeftClick(function() action_wheel:setPage(P[1]) end)')
    expect(s).toContain('if not toggles.blink then')
    expect(s).toContain('elseif k == "physics" then phys.setEnabled(on)')
    parse(s)
  })

  it('auria wheel: sub-pages, toggles, emoji and its own settings file', () => {
    const cfg = figuraDefaults(64)
    cfg.wheel = 'auria'
    cfg.wheelPages = syncWheel(cfg)
    cfg.wheelPages[1].items = cfg.wheelPages[1].items.map((it) => (it.expr === 'sad' ? { ...it, icon: { kind: 'emoji', text: ':cry:' } } : it))
    cfg.wheelPages[1].groupSize = 4
    const s = buildScript('T', cfg, info, [hair])
    expect(s).toContain('P[1] = wheel.newPage():setTitle("Main")')
    expect(s).toContain('P[2] = wheel.newPage():setTitle("Expressions"):setGroupSize(4)')
    expect(s).toContain('P[1]:newAction():setTitle("Expressions"):setIconItem("minecraft:painting"):setPage(P[2])')
    expect(s).toContain('P[1]:newToggle():setTitle("Blinking")')
    expect(s).toContain('setIconEmoji(":cry:")')
    expect(s).toContain(':newAction():setTitle("Back"):setIconItem("minecraft:arrow"):setPage(P[1])') // a Back button besides right click
    parse(s)
    const conf = auriaConf({ ...cfg, auriaStyle: { ...DEFAULT_AURIA, overlay: '#ff0000', overlayAlpha: 0.3, blur: false, mode: 'TOGGLE', animations: false } })
    expect(conf).toContain('overlayColor = vec(1, 0, 0, 0.3)')
    expect(conf).toContain('postEffect = nil')
    expect(conf).toContain('mode = "TOGGLE"')
    expect(conf).toContain('noAnimations = true')
    parse(conf)
  })

  it('draws uploaded pictures and face frames from the avatar texture', () => {
    const cfg = figuraDefaults(64)
    cfg.wheelPages = syncWheel(cfg)
    cfg.wheelPages[1].items = cfg.wheelPages[1].items.map((it) =>
      it.expr === 'happy' ? { ...it, id: 'img1', icon: { kind: 'image', src: 'data:', size: 32 } } : it.expr === 'sad' ? { ...it, icon: { kind: 'face', frame: 'happy' } } : it
    )
    const s = buildScript('T', cfg, info, [hair])
    expect(s).toContain('local TEX = textures["model.skin"] or textures:getTextures()[1]')
    expect(s).toContain('title("Happy"):texture(TEX, 32, 64, 32, 32, 0.5)')
    expect(s).toContain('title("Sad"):texture(TEX, 16, 64, 8, 8, 2)')
    const a = buildScript('T', { ...cfg, wheel: 'auria' }, info, [hair])
    expect(a).toContain(':setIconTexture(TEX, vec(32, 64), vec(32, 32))')
    parse(s)
    parse(a)
  })

  it('drops buttons that would do nothing, and pages left empty', () => {
    const cfg = figuraDefaults(64)
    cfg.wheelPages = syncWheel(cfg)
    cfg.wheelPages[1].items = cfg.wheelPages[1].items.map((it) => (it.expr === 'happy' ? { ...it, hidden: true } : it))
    const pages = liveWheel(cfg, { frames: (f) => f === 'happy', physics: false })
    // happy hidden, others have no frame -> no expressions, so no "normal face" and no expressions page
    expect(pages[0].items.map((i) => i.toggle ?? i.type)).toEqual([])
    const s = buildScript('T', cfg, { ...info, hairChains: [], faceParts: { happy: 'F_happy' } }, [])
    expect(s).not.toContain('action_wheel')
    parse(s)
  })

  it('places new custom expressions and forgets deleted ones', () => {
    const cfg = figuraDefaults(64)
    cfg.customExpr = [{ id: 'a', name: 'Smirk', coversEyes: false }]
    const pages = syncWheel(cfg)
    const faces = pages[1].items
    expect(faces.at(-1)?.type).toBe('clear') // stays last
    expect(faces.some((i) => i.expr === 'x_a')).toBe(true)
    expect(itemView(cfg, faces.find((i) => i.expr === 'x_a')!)).toMatchObject({ title: 'Smirk', icon: { kind: 'face', frame: 'x_a' } })
    cfg.wheelPages = pages
    cfg.customExpr = []
    expect(syncWheel(cfg)[1].items.some((i) => i.expr === 'x_a')).toBe(false)
  })

  it('converts the old single-page wheel settings', () => {
    const old = { ...figuraDefaults(64), wheelPages: undefined, wheelOrder: ['sad'], wheelTitle: 'Faces', buttons: { happy: { title: 'Yay', icon: ':smile:', color: '#ff0000' } } } as never
    const cfg = { ...figuraDefaults(64), ...migrateWheel(old) }
    expect(cfg.wheelPages[1].title).toBe('Faces')
    expect(cfg.wheelPages[1].items.map((i) => i.expr ?? i.type).slice(0, 2)).toEqual(['sad', 'happy'])
    expect(cfg.wheelPages[1].items[1]).toMatchObject({ title: 'Yay', icon: { kind: 'emoji', text: ':smile:' }, color: '#ff0000' })
    expect('buttons' in cfg).toBe(false)
  })

  it('keeps the bundled auria wheel parseable', () => {
    for (const f of ['core.lua', 'init.lua', 'main.lua', 'conf.lua', 'color_picker.lua', 'action/toggle.lua', 'action/slider.lua', 'action/dropdown.lua'])
      expect(() => luaparse.parse(readFileSync('src/figura/auria_wheel/' + f, 'utf8'), { luaVersion: '5.2' }), f).not.toThrow()
  })
})


describe('smooth hair, glowing eyes and glow switches', () => {
  it('keeps a plane one smooth piece (old split planes too) with curve and flutter', () => {
    const h = { ...hair, strands: 3, curl: 30, flutter: 0.5 }
    const { model, info } = buildModel(input({ hair: [h], faceFrames: [] })) as { model: Any; info: any }
    expect(info.hairChains).toHaveLength(1)
    expect(info.hairChains[0].path).toEqual(['Hair1', 's1', 's2', 's3'])
    expect(model.groups.find((g: Any) => g.name === 's1').rotation[0]).toBeCloseTo(10) // 30° over 3 segments
    const s = buildScript('T', figuraDefaults(64), info, [h])
    expect(s.match(/phys\.chain\(/g)).toHaveLength(1)
    expect(s).toContain('flutter = 0.5')
    expect(s).toContain('gravity = 1') // hangs down when bending (default on)
    parse(s)
    expect(buildScript('T', figuraDefaults(64), info, [{ ...h, hang: false }])).toContain('gravity = 0')
  })
  it('exports glowing eyes and a glow switch per part', () => {
    const slots = { ...input().slots, face_base: { x: 0, y: 72, w: 8, h: 8 }, eyes_glow: { x: 24, y: 64, w: 8, h: 8 } }
    const h2 = { ...hair, id: 'h2', name: 'Bangs', glow: true }
    const { model, info } = buildModel(input({ slots: { ...slots, hair_h2: { x: 40, y: 64, w: 8, h: 8 } }, hair: [hair, h2], faceFrames: ['base', 'blink'], glowDataUrl: 'data:image/png;base64,', glowSkin: true })) as { model: Any; info: any }
    expect(info.glow.eyes).toBe(true)
    expect(info.glow.hair).toEqual(['h2'])
    expect(info.glow.skinParts).toContain('Head.Head')
    expect(model.elements.some((e: Any) => e.name === 'GlowEyes')).toBe(true)
    const cfg = figuraDefaults(64)
    cfg.wheelPages = [{ id: 'main', title: 'Main', items: [
      { id: 'a', type: 'toggle', toggle: 'glow', title: '' },
      { id: 'b', type: 'toggle', toggle: 'glowEyes', title: '' },
      { id: 'c', type: 'toggle', toggle: 'glowHair:h2', title: '' },
      { id: 'd', type: 'toggle', toggle: 'glowHair:h1', title: '' } // h1 doesn't glow: left out
    ] }]
    const s = buildScript('T', cfg, info, [hair, h2])
    expect(s).toContain('glowEyes:setVisible(not state.blink')
    expect(s).toContain('for _, p in ipairs({ M.Head.Face.GlowEyes }) do p:setSecondaryRenderType(on and "EMISSIVE" or "NONE") end')
    expect(s).toContain('for _, p in ipairs({ M.Head.Hair2 }) do')
    expect(s).toContain('M.Head.Head')
    expect(s).not.toContain('glowHair:h1')
    parse(s)
  })
  it('adds the glow switch once to older wheels', () => {
    const old = { ...figuraDefaults(64), wheelV: undefined, wheelPages: [{ id: 'main', title: 'Main', items: [] }] } as never
    const cfg = migrateWheel(old) as { wheelPages: { items: { toggle?: string }[] }[]; wheelV: number }
    expect(cfg.wheelPages[0].items.map((i) => i.toggle)).toEqual(['glow'])
    expect(cfg.wheelV).toBe(2)
  })
})

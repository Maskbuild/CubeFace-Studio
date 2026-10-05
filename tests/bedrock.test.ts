import { describe, expect, it } from 'vitest'
import { buildBedrockPack, uuidFrom, type BedrockInput } from '../src/renderer/src/bedrock/build'
import { figuraDefaults } from '../src/renderer/src/skin/figura'
import { hairDefaults } from '../src/renderer/src/skin/hair'
import { extraParts } from '../src/renderer/src/skin/extras'

const all = new Array(12).fill(true)
const input = (over: Partial<BedrockInput> = {}): BedrockInput => ({
  name: 'Test',
  author: 'Me',
  description: '',
  packId: 'abc123',
  variant: 'wide',
  atlasW: 64,
  atlasH: 96,
  slots: { hair_h1: { x: 0, y: 64, w: 8, h: 8 }, face_blink: { x: 8, y: 64, w: 8, h: 8 }, face_shy: { x: 16, y: 64, w: 8, h: 8 }, fur: { x: 24, y: 64, w: 2, h: 2 }, inner: { x: 26, y: 64, w: 2, h: 2 } },
  hair: [{ ...hairDefaults('back', 'medium'), id: 'h1', name: 'B' }],
  figura: figuraDefaults(64),
  faceFrames: ['blink', 'shy'],
  extras: extraParts('cat', 'fox'),
  used: all,
  ...over
})
type Any = Record<string, any>
const parse = (files: Record<string, string>, f: string) => JSON.parse(files[f]) as Any
const bones = (files: Record<string, string>) => parse(files, 'models/entity/nkw.geo.json')['minecraft:geometry'][0].bones as Any[]
const bone = (files: Record<string, string>, n: string): Any => bones(files).find((b) => b.name === n)!

describe('bedrock pack', () => {
  it('builds the humanoid skeleton with box UVs', () => {
    const f = buildBedrockPack(input())
    expect(bone(f, 'head').cubes[0]).toEqual({ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] })
    expect(bone(f, 'hat').cubes[0].inflate).toBe(0.5)
    expect(bone(f, 'rightArm').pivot).toEqual([-5, 22, 0])
    expect(bone(f, 'rightArm').cubes[0].origin).toEqual([-8, 12, -2])
    expect(bone(f, 'leftLeg').cubes[0].uv).toEqual([16, 48])
    const slim = buildBedrockPack(input({ variant: 'slim' }))
    expect(bone(slim, 'rightArm').cubes[0]).toMatchObject({ origin: [-7, 12, -2], size: [3, 12, 4] })
    const desc = parse(f, 'models/entity/nkw.geo.json')['minecraft:geometry'][0].description
    expect(desc).toMatchObject({ identifier: 'geometry.nkw.abc123', texture_width: 64, texture_height: 96 })
  })

  it('adds hair chains, face planes in front (-Z) and ears/tail', () => {
    const f = buildBedrockPack(input())
    expect(bone(f, 'nkw_hair1_3').parent).toBe('nkw_hair1_2')
    expect(bone(f, 'nkw_hair1').pivot[2]).toBeCloseTo(4.6) // back hair: app -4.6 -> +4.6
    expect(bone(f, 'nkw_f_blink').cubes[0].origin[2]).toBeLessThan(-4)
    expect(bone(f, 'nkw_tail_4').parent).toBe('nkw_tail_3')
    expect(bone(f, 'nkw_earr').parent).toBe('head')
  })

  it('patches the vanilla player and animates with valid-looking Molang', () => {
    const f = buildBedrockPack(input())
    const d = parse(f, 'entity/player.entity.json')['minecraft:client_entity'].description
    expect(d.geometry.nkw).toBe('geometry.nkw.abc123')
    expect(d.textures.nkw).toBe('textures/nkw/abc123')
    expect(d.scripts.animate).toContain('nkw_motion')
    expect(JSON.stringify(d.render_controllers)).toContain('controller.render.player.nkw')
    for (const line of d.scripts.pre_animation as string[]) {
      expect(line.trim().endsWith(';')).toBe(true)
      expect(line.split('(').length).toBe(line.split(')').length)
    }
    const anim = parse(f, 'animations/nkw.animation.json').animations['animation.nkw.abc123'].bones
    expect(anim.head).toBeDefined() // smooth head
    expect(anim.nkw_hair1_1.rotation[0]).toContain('v.nkw_c0o0')
    const rc = parse(f, 'render_controllers/nkw.render_controllers.json').render_controllers
    expect(rc['controller.render.player.nkw'].geometry).toBe('Geometry.nkw')
  })

  it('head-only skins keep the player\'s own skin for the other parts', () => {
    const headOnly = all.map((_, i) => i < 2)
    const f = buildBedrockPack(input({ used: headOnly, figura: { ...figuraDefaults(64), hideVanilla: 'used' } }))
    const rc = parse(f, 'render_controllers/nkw.render_controllers.json').render_controllers
    expect(rc['controller.render.player.nkw_vanilla'].part_visibility).toEqual(expect.arrayContaining([{ head: false }, { hat: false }]))
    expect(rc['controller.render.player.nkw'].part_visibility[0]).toEqual({ '*': false })
    expect(bone(f, 'body').cubes).toEqual([])
    const d = parse(f, 'entity/player.entity.json')['minecraft:client_entity'].description
    expect(JSON.stringify(d.render_controllers)).toContain('controller.render.player.first_person') // own arms in first person
  })

  it('makes stable, well-formed UUIDs', () => {
    expect(uuidFrom('x')).toBe(uuidFrom('x'))
    expect(uuidFrom('x')).not.toBe(uuidFrom('y'))
    expect(uuidFrom('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

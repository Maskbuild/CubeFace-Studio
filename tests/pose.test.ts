import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ease, emoteTick, parseEmoteFile, parseEmotecraft, parseEmotecraftBinary, poseToEmotecraft, emoteToEmotecraft, sampleEmote } from '../src/renderer/src/pose/emote'
import { applyPose, limbAngles, limbQuaternion, mirrorPose } from '../src/renderer/src/pose/apply'
import { BUILTIN_ANIMS, BUILTIN_POSES } from '../src/renderer/src/pose/presets'
import { SkinModel } from '../src/renderer/src/three/model'
import { mannequin } from '../src/renderer/src/skin/templates'

const json = (moves: object[], extra: object = {}) =>
  JSON.stringify({ name: 'T', author: 'A', emote: { beginTick: 0, endTick: 20, stopTick: 24, isLoop: 'true', returnTick: 0, degrees: false, moves, ...extra } })

describe('Emotecraft JSON', () => {
  it('keeps limb offsets relative to the default position and reads easing', () => {
    const e = parseEmotecraft(json([{ tick: 10, easing: 'EASEINOUTQUAD', rightArm: { x: -5, y: 4, pitch: -1 } }]))
    expect(e.tracks.rightArm!.x![0].value).toBe(0) // -5 is the arm's default
    expect(e.tracks.rightArm!.y![0].value).toBe(2)
    expect(e.loop).toBe(true)
    expect(sampleEmote(e, 10).rightArm!.pitch).toBeCloseTo(-1)
    expect(sampleEmote(e, 5).rightArm!.pitch).toBeCloseTo(-0.5) // linear from the default into the first key
  })
  it('handles degrees, turns and the old "torso" name for the body', () => {
    const e = parseEmotecraft(json([{ tick: 5, turn: 1, torso: { pitch: 90 } }], { degrees: true }))
    expect(e.tracks.body!.pitch![0].value).toBeCloseTo(Math.PI / 2 + Math.PI * 2)
    expect(e.tracks.torso).toBeUndefined()
  })
  it('loops back to returnTick and eases one-shot emotes back to default', () => {
    const loop = parseEmotecraft(json([{ tick: 20, head: { yaw: 1 } }], { returnTick: 10 }))
    expect(emoteTick(loop, 25)).toBe(15)
    const once = parseEmotecraft(json([{ tick: 20, head: { yaw: 1 } }], { isLoop: false }))
    expect(sampleEmote(once, 20).head!.yaw).toBeCloseTo(1)
    expect(sampleEmote(once, 24).head!.yaw).toBeCloseTo(0)
  })
  it('rejects files that are not emotes', () => {
    expect(() => parseEmotecraft('{"a":1}')).toThrow(/emote/)
    expect(() => parseEmotecraft('nope')).toThrow(/JSON/)
  })
  it('writes poses and emotes back as Emotecraft JSON', () => {
    const pose = { rightArm: { pitch: -1, x: 1 }, body: { y: -0.5 } }
    const back = parseEmotecraft(poseToEmotecraft(pose, 'P', 'me'))
    expect(sampleEmote(back, 1).rightArm).toMatchObject({ pitch: -1, x: 1 })
    expect(sampleEmote(back, 1).body!.y).toBeCloseTo(-0.5)
    const walk = BUILTIN_ANIMS.find((a) => a.id === 'builtin:walk')!
    const again = parseEmotecraft(emoteToEmotecraft(walk))
    expect(sampleEmote(again, 10).rightLeg!.pitch).toBeCloseTo(sampleEmote(walk, 10).rightLeg!.pitch!)
  })
})

/** A minimal binary emote in Emotecraft's packet format (header + legacy animation v2). */
function binaryEmote(): Uint8Array {
  const b: number[] = []
  const i32 = (v: number) => b.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255)
  const f32 = (v: number) => {
    const d = new DataView(new ArrayBuffer(4))
    d.setFloat32(0, v)
    b.push(...new Uint8Array(d.buffer))
  }
  const str = (s: string) => {
    const u = new TextEncoder().encode(s)
    i32(u.length)
    b.push(...u)
  }
  const sub = (id: number, ver: number, body: () => void) => {
    b.push(id, ver)
    const at = b.length
    i32(0)
    const start = b.length
    body()
    const size = b.length - start
    b.splice(at, 4, (size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255)
  }
  const track = (keys: [number, number, number][]) => {
    b.push(1)
    i32(keys.length)
    for (const [t, v, e] of keys) (i32(t), f32(v), b.push(e))
  }
  i32(8)
  b.push(0x10, 2)
  sub(0x11, 2, () => (str('"Bow"'), str(''), str('{"text":"KosmX"}'), str(''), i32(0)))
  sub(0x00, 2, () => {
    i32(0) // tick
    i32(0), i32(40), i32(44), b.push(0), i32(0), b.push(0, 0, 9) // header, not looped
    i32(2)
    str('head')
    for (let k = 0; k < 6; k++) track(k === 3 ? [[20, 0.5, 14]] : [])
    str('rightArm')
    for (let k = 0; k < 8; k++) track(k === 0 ? [[20, -4, 0]] : k === 7 ? [[20, -1.2, 0]] : []) // x, …, axis, bend
  })
  for (let k = 0; k < 16; k++) b.push(0) // (uuid would follow inside the animation; extra bytes are ignored)
  return new Uint8Array(b)
}

describe('Emotecraft binary', () => {
  it('reads header text, keyframes, easing ids and bend tracks', () => {
    const e = parseEmotecraftBinary(binaryEmote())
    expect(e.name).toBe('Bow')
    expect(e.author).toBe('KosmX')
    expect(e.loop).toBe(false)
    expect(e.tracks.head!.pitch![0]).toMatchObject({ tick: 20, value: 0.5, easing: 'EASEINOUTQUAD' })
    expect(e.tracks.rightArm!.x![0].value).toBeCloseTo(1) // -4 absolute = +1 from the default
    expect(e.tracks.rightArm!.bend![0].value).toBeCloseTo(-1.2)
    expect(parseEmoteFile(binaryEmote(), 'x.emotecraft').name).toBe('Bow')
  })

  // real files from Prism instances on this computer, when present
  const root = `${process.env.APPDATA}/PrismLauncher/instances`
  const files = existsSync(root)
    ? readdirSync(root).flatMap((i) => {
        const d = `${root}/${i}/minecraft/emotes`
        return existsSync(d) ? readdirSync(d).filter((f) => /\.(json|emotecraft)$/i.test(f)).map((f) => `${d}/${f}`) : []
      })
    : []
  it.skipIf(!files.length)('reads every emote found in Prism instances', () => {
    for (const f of files) {
      const e = parseEmoteFile(new Uint8Array(readFileSync(f)), f.split('/').pop()!)
      expect(Object.keys(e.tracks).length, f).toBeGreaterThan(0)
      expect(Number.isFinite(sampleEmote(e, e.endTick / 2).rightArm?.pitch ?? 0), f).toBe(true)
    }
  })
})

describe('posing the model', () => {
  it('converts angles both ways', () => {
    const s = { pitch: -0.7, yaw: 0.4, roll: 0.3 }
    const a = limbAngles(limbQuaternion(s, new THREE.Quaternion()))
    expect(a.pitch).toBeCloseTo(s.pitch)
    expect(a.yaw).toBeCloseTo(s.yaw)
    expect(a.roll).toBeCloseTo(s.roll)
  })
  it('swings an arm forward for negative pitch, lifts it outward for roll and folds the elbow', () => {
    const m = new SkinModel(mannequin(64, 'wide'), 'wide')
    m.setBendable(true)
    const hand = () => new THREE.Vector3(-5, 10, 0).sub(new THREE.Vector3(-5, 22, 0)).applyQuaternion(m.parts.rightArm.quaternion)
    applyPose(m, { rightArm: { pitch: -Math.PI / 2 } })
    expect(hand().z).toBeGreaterThan(11) // app front is +Z
    applyPose(m, { rightArm: { roll: Math.PI / 2 } })
    expect(hand().x).toBeLessThan(-11) // player's right is -X
    applyPose(m, { body: { y: -0.5 } })
    expect(m.group.position.y).toBeCloseTo(-8)
    applyPose(m, { body: { pitch: -Math.PI / 2 } }) // bow forward
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(m.group.quaternion).z).toBeGreaterThan(0.99)
    m.resetPose()
    expect(m.group.position.y).toBe(0)
    m.dispose()
  })
  it('mirrors left and right', () => {
    const p = mirrorPose({ rightArm: { roll: 1, pitch: -1 }, head: { yaw: 0.5 } })
    expect(p.leftArm).toEqual({ roll: -1, pitch: -1 })
    expect(p.rightArm).toBeUndefined()
    expect(p.head!.yaw).toBe(-0.5)
  })
  it('has working presets and animations', () => {
    expect(BUILTIN_POSES.length).toBeGreaterThan(5)
    for (const a of BUILTIN_ANIMS) expect(Object.keys(sampleEmote(a, a.endTick / 3)).length, a.id).toBeGreaterThan(0)
    expect(ease('EASEINOUTQUAD', 0.5)).toBeCloseTo(0.5)
    expect(ease('CONSTANT', 0.9)).toBe(0)
  })
})

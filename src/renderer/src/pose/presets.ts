import type { Bone, BoneState, Emote, PoseState } from './emote'

/*
 * Built-in poses and animations, written in the Emotecraft convention (radians; arm pitch < 0
 * swings forward, right arm roll > 0 lifts it out to the side, bend < 0 folds an elbow forward).
 */

const D = Math.PI / 180
const deg = (s: Record<string, number>): BoneState => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, ['x', 'y', 'z'].includes(k) ? v : v * D]))
const pose = (p: Partial<Record<Bone, Record<string, number>>>): PoseState => Object.fromEntries(Object.entries(p).map(([b, s]) => [b, deg(s!)]))

export interface PosePreset {
  id: string
  name: string // i18n key under pose.presets
  pose: PoseState
  builtin?: boolean
}

export const BUILTIN_POSES: PosePreset[] = [
  { id: 'stand', name: 'stand', pose: {} },
  { id: 'tpose', name: 'tpose', pose: pose({ rightArm: { roll: 90 }, leftArm: { roll: -90 } }) },
  { id: 'wave', name: 'wave', pose: pose({ rightArm: { roll: 140, pitch: -10, bend: -40 }, head: { yaw: -10 } }) },
  { id: 'point', name: 'point', pose: pose({ rightArm: { pitch: -90, yaw: 10 }, head: { pitch: -5 } }) },
  { id: 'cheer', name: 'cheer', pose: pose({ rightArm: { roll: 160 }, leftArm: { roll: -160 }, head: { pitch: -20 } }) },
  { id: 'think', name: 'think', pose: pose({ rightArm: { pitch: -60, yaw: -30, bend: -110 }, leftArm: { pitch: -30, yaw: 40, bend: -80 }, head: { pitch: 15, yaw: 10 } }) },
  { id: 'hips', name: 'hips', pose: pose({ rightArm: { roll: 35, bend: -70, axis: 90 }, leftArm: { roll: -35, bend: -70, axis: -90 } }) },
  { id: 'sit', name: 'sit', pose: pose({ body: { y: -0.6 }, rightLeg: { pitch: -90, yaw: 8 }, leftLeg: { pitch: -90, yaw: -8 }, rightArm: { pitch: -30 }, leftArm: { pitch: -30 } }) },
  { id: 'salute', name: 'salute', pose: pose({ rightArm: { pitch: -120, yaw: -45, bend: -120 } }) },
  { id: 'run', name: 'runPose', pose: pose({ rightArm: { pitch: 50, bend: -60 }, leftArm: { pitch: -60, bend: -70 }, rightLeg: { pitch: -60, bend: 70 }, leftLeg: { pitch: 30, bend: 40 }, body: { pitch: 10 } }) }
]

type Key = { tick: number; easing?: string; p: Partial<Record<Bone, Record<string, number>>> }

/** Build an Emote from a few key poses (each listed value becomes a keyframe). */
function anim(id: string, name: string, end: number, keys: Key[], loop = true): Emote {
  const tracks: Emote['tracks'] = {}
  for (const k of keys)
    for (const [b, s] of Object.entries(k.p))
      for (const [a, v] of Object.entries(deg(s!))) ((tracks[b as Bone] ??= {})[a as keyof BoneState] ??= []).push({ tick: k.tick, value: v!, easing: k.easing ?? 'EASEINOUTSINE' })
  return { id: 'builtin:' + id, name, author: 'NKW', description: '', beginTick: 0, endTick: end, stopTick: end + 4, loop, returnTick: 0, easeBefore: true, tracks, builtin: true }
}

const swing = (a: number, l: number, extra: Key['p'] = {}): Key['p'] => ({
  rightArm: { pitch: a }, leftArm: { pitch: -a }, rightLeg: { pitch: -l }, leftLeg: { pitch: l }, ...extra
})

export const BUILTIN_ANIMS: Emote[] = [
  anim('idle', 'idle', 60, [
    { tick: 0, p: { rightArm: { roll: 3 }, leftArm: { roll: -3 }, head: { pitch: 0 } } },
    { tick: 30, p: { rightArm: { roll: 6 }, leftArm: { roll: -6 }, head: { pitch: 3 } } },
    { tick: 60, p: { rightArm: { roll: 3 }, leftArm: { roll: -3 }, head: { pitch: 0 } } }
  ]),
  anim('walk', 'walk', 20, [
    { tick: 0, p: swing(35, 35) },
    { tick: 10, p: swing(-35, -35) },
    { tick: 20, p: swing(35, 35) }
  ]),
  anim('run', 'run', 12, [
    { tick: 0, p: swing(60, 55, { rightArm: { pitch: 60, bend: -70 }, leftArm: { pitch: -60, bend: -70 }, body: { pitch: 8, y: 0 } }) },
    { tick: 3, p: { body: { y: 0.06 } } },
    { tick: 6, p: swing(-60, -55, { rightArm: { pitch: -60, bend: -70 }, leftArm: { pitch: 60, bend: -70 }, body: { pitch: 8, y: 0 } }) },
    { tick: 9, p: { body: { y: 0.06 } } },
    { tick: 12, p: swing(60, 55, { rightArm: { pitch: 60, bend: -70 }, leftArm: { pitch: -60, bend: -70 }, body: { pitch: 8, y: 0 } }) }
  ]),
  anim('sneak', 'sneak', 30, [
    { tick: 0, p: { ...swing(15, 25), body: { bend: 30, y: -0.08 }, head: { pitch: -15 } } },
    { tick: 15, p: { ...swing(-15, -25), body: { bend: 30, y: -0.08 }, head: { pitch: -15 } } },
    { tick: 30, p: { ...swing(15, 25), body: { bend: 30, y: -0.08 }, head: { pitch: -15 } } }
  ]),
  anim('wave', 'waveAnim', 20, [
    { tick: 0, p: { rightArm: { roll: 135, bend: -30 }, head: { yaw: -10 } } },
    { tick: 5, p: { rightArm: { roll: 160, bend: -50 } } },
    { tick: 10, p: { rightArm: { roll: 135, bend: -30 } } },
    { tick: 15, p: { rightArm: { roll: 160, bend: -50 } } },
    { tick: 20, p: { rightArm: { roll: 135, bend: -30 }, head: { yaw: -10 } } }
  ]),
  anim('zombie', 'zombie', 24, [
    { tick: 0, p: { rightArm: { pitch: -90, yaw: -4 }, leftArm: { pitch: -85, yaw: 4 }, rightLeg: { pitch: 20 }, leftLeg: { pitch: -20 }, head: { roll: 6 } } },
    { tick: 12, p: { rightArm: { pitch: -85, yaw: -4 }, leftArm: { pitch: -90, yaw: 4 }, rightLeg: { pitch: -20 }, leftLeg: { pitch: 20 }, head: { roll: -6 } } },
    { tick: 24, p: { rightArm: { pitch: -90, yaw: -4 }, leftArm: { pitch: -85, yaw: 4 }, rightLeg: { pitch: 20 }, leftLeg: { pitch: -20 }, head: { roll: 6 } } }
  ]),
  anim('dance', 'dance', 20, [
    { tick: 0, p: { body: { roll: 8, y: 0 }, rightArm: { roll: 120, bend: -60 }, leftArm: { roll: -40 }, head: { roll: -8 } } },
    { tick: 5, p: { body: { y: -0.06 } } },
    { tick: 10, p: { body: { roll: -8, y: 0 }, rightArm: { roll: 40 }, leftArm: { roll: -120, bend: -60 }, head: { roll: 8 } } },
    { tick: 15, p: { body: { y: -0.06 } } },
    { tick: 20, p: { body: { roll: 8, y: 0 }, rightArm: { roll: 120, bend: -60 }, leftArm: { roll: -40 }, head: { roll: -8 } } }
  ])
]

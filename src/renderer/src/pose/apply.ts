import * as THREE from 'three'
import { PIVOTS, type SkinModel } from '../three/model'
import type { PartId } from '../skin/layout'
import type { Bone, BoneState, PoseState } from './emote'

/*
 * Puts a pose (Emotecraft convention) on the editor's skin model.
 * Minecraft model space (y down, front -Z) maps to app space (y up, front +Z) by a half turn
 * about X: offsets (x, -y, -z), rotations stay ZYX with (pitch, -yaw, -roll).
 * "body" moves the whole player in entity space (blocks, y up, front -Z, right +X), turning
 * around the hips like playerAnimator; its bend folds the upper body at the waist.
 */

const LIMBS: [Bone, PartId][] = [
  ['head', 'head'],
  ['rightArm', 'rightArm'],
  ['leftArm', 'leftArm'],
  ['rightLeg', 'rightLeg'],
  ['leftLeg', 'leftLeg']
]
const HIP = 0.7 * 16 // playerAnimator turns the body around 0.7 blocks above the feet
const WAIST = 18 // bendy-lib folds the torso halfway up the body (12..24)

const q = new THREE.Quaternion()
const e = new THREE.Euler()
const v = new THREE.Vector3()
const axisV = new THREE.Vector3()

/** Rotation of a limb in app space from Emotecraft angles. */
export function limbQuaternion(s: BoneState, out = new THREE.Quaternion()) {
  return out.setFromEuler(e.set(s.pitch ?? 0, -(s.yaw ?? 0), -(s.roll ?? 0), 'ZYX'))
}

/** Emotecraft angles from a limb rotation in app space (inverse of limbQuaternion). */
export function limbAngles(quat: THREE.Quaternion): { pitch: number; yaw: number; roll: number } {
  e.setFromQuaternion(quat, 'ZYX')
  return { pitch: e.x + 0, yaw: -e.y + 0, roll: -e.z + 0 }
}

/** Bend axis in app space for a bendy-lib "axis" (bend direction) angle. */
export const bendAxis = (a: number, out = new THREE.Vector3()) => out.set(Math.cos(a), 0, -Math.sin(a))

export function applyPose(model: SkinModel, pose: PoseState) {
  model.resetPose()
  for (const [b, p] of LIMBS) {
    const s = pose[b]
    if (!s) continue
    const g = model.parts[p]
    const pv = PIVOTS[p]
    g.position.set(pv[0] + (s.x ?? 0), pv[1] - (s.y ?? 0), pv[2] - (s.z ?? 0))
    limbQuaternion(s, g.quaternion)
    if (b !== 'head' && s.bend) model.setBend(p, s.bend, s.axis ?? 0)
  }

  // upper body: torso rotation (format v3) and the body's bend fold head, arms and the top of the body
  const upper: PartId[] = ['head', 'rightArm', 'leftArm']
  const fold = (rot: THREE.Quaternion, pivotY: number) => {
    for (const p of upper) {
      const g = model.parts[p]
      v.copy(g.position).sub(axisV.set(0, pivotY, 0)).applyQuaternion(rot).add(axisV)
      g.position.copy(v)
      g.quaternion.premultiply(rot)
    }
  }
  const torso = pose.torso
  if (torso && (torso.pitch || torso.yaw || torso.roll)) {
    limbQuaternion(torso, q)
    fold(q, 12)
    model.parts.body.position.set(0, 12, 0).add(v.set(0, 12, 0).applyQuaternion(q))
    model.parts.body.quaternion.copy(q)
  }
  const body = pose.body
  if (body?.bend) {
    model.setBend('body', body.bend, body.axis ?? 0)
    fold(q.setFromAxisAngle(bendAxis(body.axis ?? 0, axisV).clone(), body.bend), WAIST)
  }

  // whole player
  if (body) {
    // entity space -> app: half turn about Y (x and z flip, so pitch and roll flip)
    q.setFromEuler(e.set(-(body.pitch ?? 0), body.yaw ?? 0, -(body.roll ?? 0), 'ZYX'))
    model.group.quaternion.copy(q)
    v.set(0, HIP, 0).applyQuaternion(q)
    model.group.position.set(-(body.x ?? 0) * 16, (body.y ?? 0) * 16 + HIP - v.y, -(body.z ?? 0) * 16)
    model.group.position.x -= v.x
    model.group.position.z -= v.z
  }
}

/** Swap left and right (mirror the pose across the body's middle). */
export function mirrorPose(p: PoseState): PoseState {
  const flip = (s?: BoneState): BoneState | undefined =>
    s && { ...s, x: s.x !== undefined ? -s.x : undefined, yaw: s.yaw !== undefined ? -s.yaw : undefined, roll: s.roll !== undefined ? -s.roll : undefined, axis: s.axis !== undefined ? -s.axis : undefined }
  const clean = (s?: BoneState) => (s ? (Object.fromEntries(Object.entries(s).filter(([, x]) => x !== undefined)) as BoneState) : undefined)
  const out: PoseState = {}
  const set = (b: Bone, s?: BoneState) => {
    const c = clean(s)
    if (c && Object.keys(c).length) out[b] = c
  }
  set('head', flip(p.head))
  set('body', flip(p.body))
  set('torso', flip(p.torso))
  set('rightArm', flip(p.leftArm))
  set('leftArm', flip(p.rightArm))
  set('rightLeg', flip(p.leftLeg))
  set('leftLeg', flip(p.rightLeg))
  return out
}

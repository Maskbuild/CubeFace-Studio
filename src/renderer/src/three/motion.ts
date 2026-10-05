import type { Motion } from '../skin/hair'
import type { SkinModel } from './model'

export type MotionMode = 'off' | 'idle' | 'walk' | 'run' | 'jump' | 'look' | 'camera'
export const MOTION_MODES: MotionMode[] = ['off', 'idle', 'walk', 'run', 'jump', 'look', 'camera']

const TICK = 1 / 20

/**
 * Drives a simple in-place animation of the skin model and reports the head's motion each
 * game tick, so hair physics can be previewed without launching Minecraft.
 */
export class MotionDriver {
  mode: MotionMode = 'off'
  private t = 0
  private acc = 0
  private lastYaw = 0
  /** For 'camera' mode: where the head should look [pitch, yaw] in radians (set by the viewport). */
  cameraLook: [number, number] = [0, 0]

  /** Advance by dt seconds; calls onTick for every elapsed game tick. Returns tick alpha (0..1). */
  update(dt: number, model: SkinModel, onTick: (m: Motion) => void): number {
    if (this.mode === 'off') {
      this.t = 0
      this.acc = 0
      return 1
    }
    this.acc += Math.min(dt, 0.25)
    while (this.acc >= TICK) {
      this.acc -= TICK
      this.t += TICK
      onTick(this.motion(this.t))
    }
    const alpha = this.acc / TICK
    this.pose(model, this.t + this.acc)
    return alpha
  }

  private headAngles(t: number): [number, number] {
    switch (this.mode) {
      case 'camera':
        return this.cameraLook
      case 'look':
        return [Math.sin(t * 1.3) * 0.5, Math.sin(t * 0.9) * 1.0]
      case 'idle':
        return [Math.sin(t * 0.7) * 0.05, Math.sin(t * 0.4) * 0.15]
      default:
        return [0, 0]
    }
  }

  private jumpHeight(t: number) {
    const p = t % 1.2
    return p < 0.6 ? Math.sin((p / 0.6) * Math.PI) * 1.25 : 0 // blocks
  }

  private motion(t: number): Motion {
    const [pitch, yaw] = this.headAngles(t)
    const yawRate = yaw - this.lastYaw
    this.lastYaw = yaw
    const vz = this.mode === 'walk' ? 0.216 : this.mode === 'run' ? 0.28 : 0
    const vy = this.mode === 'jump' ? (this.jumpHeight(t) - this.jumpHeight(t - TICK)) : this.mode === 'idle' ? Math.sin(t * 2) * 0.004 : 0
    return { vx: 0, vy, vz, pitch, yawRate }
  }

  private pose(model: SkinModel, t: number) {
    const p = model.parts
    model.resetPose()
    const [pitch, yaw] = this.headAngles(t)
    p.head.rotation.set(pitch, yaw, 0, 'YXZ')
    if (this.mode === 'walk' || this.mode === 'run') {
      const speed = this.mode === 'run' ? 13 : 9
      const amp = this.mode === 'run' ? 1.0 : 0.7
      const s = Math.sin(t * speed) * amp
      p.rightLeg.rotation.x = s
      p.leftLeg.rotation.x = -s
      p.rightArm.rotation.x = -s
      p.leftArm.rotation.x = s
      model.group.position.y = Math.abs(Math.cos(t * speed)) * 0.6
    }
    if (this.mode === 'idle') {
      p.rightArm.rotation.z = -0.05 - Math.sin(t * 1.5) * 0.03
      p.leftArm.rotation.z = 0.05 + Math.sin(t * 1.5) * 0.03
    }
    if (this.mode === 'jump') {
      model.group.position.y = this.jumpHeight(t) * 16
      const air = this.jumpHeight(t) > 0 ? 1 : 0
      p.rightArm.rotation.z = -0.5 * air
      p.leftArm.rotation.z = 0.5 * air
    }
  }
}

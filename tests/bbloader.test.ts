import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { loadBBModel } from '../src/renderer/src/three/bbLoader'
import { buildModel } from '../src/renderer/src/figura/bbmodel'
import { figuraDefaults } from '../src/renderer/src/skin/figura'

/** World position + uv of every vertex of every mesh. */
function vertices(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const out: { p: THREE.Vector3; uv: [number, number] }[] = []
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const pos = m.geometry.getAttribute('position')
    const uv = m.geometry.getAttribute('uv')
    for (let i = 0; i < pos.count; i++) out.push({ p: new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld), uv: [uv.getX(i), uv.getY(i)] })
  })
  return out
}

describe('bbmodel loader', () => {
  it('round-trips our exported head: front face corners sample the face texture', async () => {
    const { model } = buildModel({
      name: 'T', variant: 'wide', res: 64, atlasW: 64, atlasH: 64, atlasDataUrl: '', slots: {}, hair: [], figura: figuraDefaults(64), faceFrames: []
    })
    const m = await loadBBModel(model, async () => null)
    const v = vertices(m.root)
    // after the 180° turn, the face is at +Z (app space) and the player's right is -X
    const near = (x: number, y: number, z: number) => v.filter((q) => q.p.distanceTo(new THREE.Vector3(x, y, z)) < 1e-4)
    const topRightOfPlayer = near(-4, 32, 4).map((q) => q.uv.map((n) => Math.round(n * 64)))
    // front face top-left texel (8,8) is on the player's right (viewer's left)
    expect(topRightOfPlayer).toContainEqual([8, 8])
    const bottomLeftOfPlayer = near(4, 24, 4).map((q) => q.uv.map((n) => Math.round(n * 64)))
    expect(bottomLeftOfPlayer).toContainEqual([16, 16])
    // right arm sits on -X in app space
    const arm = v.filter((q) => q.p.y <= 24 && q.p.y >= 12 && q.p.x < -7.5)
    expect(arm.length).toBeGreaterThan(0)
    m.dispose()
  })

  it('handles v4-style nested outliner groups and mesh elements', async () => {
    const json = {
      resolution: { width: 16, height: 16 },
      textures: [{ name: 't.png' }],
      elements: [{ uuid: 'm1', type: 'mesh', origin: [0, 0, 0], vertices: { a: [0, 0, 0], b: [1, 0, 0], c: [1, 1, 0], d: [0, 1, 0] }, faces: { f: { vertices: ['a', 'b', 'c', 'd'], uv: { a: [0, 16], b: [16, 16], c: [16, 0], d: [0, 0] }, texture: 0 } } }],
      outliner: [{ name: 'G', uuid: 'g1', origin: [0, 0, 0], rotation: [0, 0, 0], children: ['m1'] }]
    }
    const m = await loadBBModel(json, async () => null)
    expect(vertices(m.root)).toHaveLength(4)
  })
})

describe('attached avatars follow the skin', () => {
  it('finds outermost keyword groups and mirrors part rotations correctly', async () => {
    const { model } = buildModel({
      name: 'T', variant: 'wide', res: 64, atlasW: 64, atlasH: 64, atlasDataUrl: '', slots: {}, hair: [], figura: figuraDefaults(64), faceFrames: []
    })
    const m = await loadBBModel(model, async () => null)
    expect(m.keywords.Head).toHaveLength(1)
    expect(m.keywords.RightArm).toHaveLength(1)
    // skin head turned left (+X) and looking down, as the editor sets it
    const skinHead = new THREE.Object3D()
    skinHead.position.set(0, 24, 0)
    skinHead.rotation.set(0.4, 0.6, 0, 'YXZ')
    skinHead.updateMatrixWorld(true)
    const expected = new THREE.Vector3(0, 4, 4).applyMatrix4(skinHead.matrixWorld) // centre of the face
    const q = skinHead.quaternion
    const g = m.keywords.Head[0]
    g.quaternion.copy(g.userData.rest).multiply(new THREE.Quaternion(-q.x, q.y, -q.z, q.w))
    m.root.updateMatrixWorld(true)
    // centre of the attached head's front face (Blockbench north = -Z, local to the head group)
    const got = new THREE.Vector3(0, 4, -4).applyMatrix4(g.matrixWorld)
    expect(got.distanceTo(expected)).toBeLessThan(1e-6)
  })
})

import { cuboidGeometry } from '../src/renderer/src/three/model'
import { cuboids } from '../src/renderer/src/skin/layout'

describe('bottom face orientation (Minecraft rule: texture top row at the back)', () => {
  it('editor model: head bottom texel (16,0) sits at the back, on the player\'s right', () => {
    const head = cuboids('wide').find((c) => c.key === 'head.base')!
    const g = cuboidGeometry(head)
    const pos = g.getAttribute('position'), uv = g.getAttribute('uv')
    // bottom face = 2nd face -> vertices 4..7; find the one with uv (16,0)/64
    let found: number[] | null = null
    for (let i = 4; i < 8; i++) if (Math.abs(uv.getX(i) - 16 / 64) < 1e-6 && Math.abs(uv.getY(i)) < 1e-6) found = [pos.getX(i), pos.getY(i), pos.getZ(i)]
    expect(found).toEqual([-4, 24, -4])
  })

  it('loaded Blockbench model agrees with the editor model', async () => {
    const { model } = buildModel({
      name: 'T', variant: 'wide', res: 64, atlasW: 64, atlasH: 64, atlasDataUrl: '', slots: {}, hair: [], figura: figuraDefaults(64), faceFrames: []
    })
    const m = await loadBBModel(model, async () => null)
    const v = vertices(m.root)
    const at = v.filter((q) => q.p.distanceTo(new THREE.Vector3(-4, 24, -4)) < 1e-4).map((q) => q.uv.map((n) => Math.round(n * 64)))
    expect(at).toContainEqual([16, 0])
  })
})

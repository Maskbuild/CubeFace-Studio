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

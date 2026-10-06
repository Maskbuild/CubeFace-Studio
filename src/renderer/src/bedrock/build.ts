import * as THREE from 'three'
import vanillaEntity from '../../../bedrock/player.entity.json'
import vanillaRc from '../../../bedrock/player.render_controllers.json'
import { cuboids, type PartId, type Variant } from '../skin/layout'
import type { HairInfo } from '../skin/hair'
import { coversEyes, type FaceFrame, type FiguraConfig } from '../skin/figura'
import type { AtlasSlot } from '../figura/atlas'

/*
 * Bedrock resource pack that replaces the player model (all players in worlds using the pack).
 * Bedrock geometry uses the app's X/Y and a mirrored Z (front = north = -Z): (x, y, z) -> (x, y, -z).
 * Skin cubes use classic box UV, so HD textures work by declaring a 64-wide UV space.
 */

type V3 = [number, number, number]
type Json = Record<string, unknown>
const r4 = (n: number) => Math.round(n * 1e4) / 1e4 + 0
const bz = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(-p[2])]

export interface BedrockInput {
  name: string
  author: string
  description: string
  packId: string // stable seed (e.g. the skin id) so re-exports update the same pack
  variant: Variant
  atlasW: number
  atlasH: number
  slots: Record<string, AtlasSlot>
  hair: HairInfo[]
  figura: FiguraConfig
  faceFrames: FaceFrame[]
  used: boolean[]
}

/** Deterministic RFC-4122-shaped UUID from a string (FNV-1a based; uniqueness, not security). */
export function uuidFrom(seed: string): string {
  const words: number[] = []
  for (let k = 0; k < 4; k++) {
    let h = 0x811c9dc5 ^ (k * 0x9e3779b9)
    for (const ch of seed + ':' + k) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193)
    words.push(h >>> 0)
  }
  const hex = words.map((w) => w.toString(16).padStart(8, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const BONE: Record<PartId, string> = { head: 'head', body: 'body', rightArm: 'rightArm', leftArm: 'leftArm', rightLeg: 'rightLeg', leftLeg: 'leftLeg' }
const LAYER: Record<PartId, string> = { head: 'hat', body: 'jacket', rightArm: 'rightSleeve', leftArm: 'leftSleeve', rightLeg: 'rightPants', leftLeg: 'leftPants' }
const PIVOT: Record<PartId, V3> = { head: [0, 24, 0], body: [0, 24, 0], rightArm: [-5, 22, 0], leftArm: [5, 22, 0], rightLeg: [-1.9, 12, 0], leftLeg: [1.9, 12, 0] }
const PARENT: Record<PartId, string> = { head: 'body', body: 'waist', rightArm: 'body', leftArm: 'body', rightLeg: 'root', leftLeg: 'root' }

/** App rotation (degrees, YXZ) mirrored across Z, as Bedrock euler degrees. */
function toBedrockRot(rot: V3): V3 {
  const D = Math.PI / 180
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * D, rot[1] * D, rot[2] * D, 'YXZ'))
  const m = new THREE.Quaternion(-q.x, -q.y, q.z, q.w) // reflection z -> -z
  const e = new THREE.Euler().setFromQuaternion(m, 'ZYX')
  return [r4(e.x / D), r4(e.y / D), r4(e.z / D)]
}

export function buildBedrockPack(inp: BedrockInput): Record<string, string> {
  const id = inp.packId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 16) || 'skin'
  const geoId = `geometry.nkw.${id}`
  const k = 64 / inp.atlasW // atlas px -> UV units
  const uvH = r4(64 * (inp.atlasH / inp.atlasW))
  const slotUV = (s: AtlasSlot, y = 0, h = s.h) => ({ uv: [r4(s.x * k), r4((s.y + y) * k)], size: [r4(s.w * k), r4(h * k)] })
  const plane = (uv: { uv: number[]; size: number[] }) => ({
    north: { uv: uv.uv, uv_size: uv.size },
    south: { uv: [r4(uv.uv[0] + uv.size[0]), uv.uv[1]], uv_size: [-uv.size[0], uv.size[1]] }
  })

  // ---- geometry ------------------------------------------------------------------------
  const bones: Json[] = [
    { name: 'root', pivot: [0, 0, 0] },
    { name: 'waist', parent: 'root', pivot: [0, 12, 0] }
  ]
  const bone = (name: string, parent: string, pivot: V3, extra: Json = {}) => {
    const b: Json = { name, parent, pivot: bz(pivot), ...extra }
    bones.push(b)
    return b
  }
  const replaced = new Set<PartId>()
  const partBones = {} as Record<PartId, Json>
  const layerBones = {} as Record<PartId, Json>
  for (const p of Object.keys(BONE) as PartId[]) {
    partBones[p] = bone(BONE[p], PARENT[p], PIVOT[p], { cubes: [] })
    layerBones[p] = bone(LAYER[p], BONE[p], PIVOT[p], { cubes: [] })
  }
  cuboids(inp.variant).forEach((c, i) => {
    if (!inp.used[i]) return
    replaced.add(c.part)
    // symmetric in Z, so the box keeps its origin; box UV maps every face like the game
    const cube: Json = { origin: [c.min[0], c.min[1], c.min[2]], size: c.size, uv: [c.faces[2].rect.x, c.faces[0].rect.y] }
    if (c.inflate) cube.inflate = c.inflate
    ;((c.kind === 'base' ? partBones : layerBones)[c.part].cubes as Json[]).push(cube)
  })
  bone('rightItem', 'rightArm', [-6, 15, 1])
  bone('leftItem', 'leftArm', [6, 15, 1])

  // face frames: planes just in front of the face (front = -Z in Bedrock)
  const frameBones: Partial<Record<FaceFrame, string>> = {}
  inp.faceFrames.forEach((f, i) => {
    const s = inp.slots['face_' + f]
    if (!s) return
    const name = `nkw_f_${f}`
    const z = 4.02 + i * 0.002
    bone(name, 'head', [0, 24, 0], { cubes: [{ origin: [-4, 24, -z], size: [8, 8, 0], uv: plane(slotUV(s)) }] })
    frameBones[f] = name
  })

  // hair planes: a bone chain per plane
  const chains: { bones: string[]; hair: HairInfo }[] = []
  inp.hair.forEach((h, hi) => {
    const s = inp.slots['hair_' + h.id]
    if (!s || !h.visible) return
    const len = h.h / h.segments
    const top: V3 = [h.pos[0], h.pos[1] + 24, h.pos[2]]
    const names: string[] = []
    const rootName = `nkw_hair${hi + 1}`
    bone(rootName, 'head', top, { rotation: toBedrockRot(h.rot) })
    let parent = rootName
    for (let i = 0; i < h.segments; i++) {
      const name = `${rootName}_${i + 1}`
      const segTop: V3 = [top[0], top[1] - i * len, top[2]]
      const rowH = s.h / h.segments
      bone(name, parent, segTop, {
        cubes: [{ origin: [r4(top[0] - h.w / 2), r4(top[1] - (i + 1) * len), r4(-top[2])], size: [h.w, r4(len), 0], uv: plane(slotUV(s, i * rowH, rowH)) }]
      })
      names.push(name)
      parent = name
    }
    chains.push({ bones: names, hair: h })
  })

  const geo = {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: { identifier: geoId, texture_width: 64, texture_height: uvH, visible_bounds_width: 3, visible_bounds_height: 3.5, visible_bounds_offset: [0, 1.25, 0] },
        bones: bones.filter((b) => !Array.isArray(b.cubes) || (b.cubes as Json[]).length || !String(b.name).match(/^(hat|jacket|rightSleeve|leftSleeve|rightPants|leftPants)$/))
      }
    ]
  }

  // ---- Molang: smooth head + spring chains (same model as nkw_physics.lua, per frame) ----
  const cfg = inp.figura
  const pre: string[] = [
    'v.nkw_dt = math.clamp(query.delta_time * 20, 0, 3);',
    'v.nkw_vz = query.modified_move_speed * 0.25;',
    'v.nkw_vy = (query.vertical_speed ?? 0) / 20;',
    'v.nkw_pitch = query.target_x_rotation * 0.01745;',
    'v.nkw_yawrate = (query.body_y_rotation - (v.nkw_lastyaw ?? query.body_y_rotation)) * 0.01745;',
    'v.nkw_lastyaw = query.body_y_rotation;'
  ]
  const anim: Record<string, Json> = {}
  if (cfg.smoothHead) {
    const sp = r4(cfg.headSpeed)
    pre.push(
      `v.nkw_hf = 1 - math.pow(${r4(1 - sp)}, v.nkw_dt);`,
      'v.nkw_hx = (v.nkw_hx ?? query.target_x_rotation) + (query.target_x_rotation - (v.nkw_hx ?? query.target_x_rotation)) * v.nkw_hf;',
      'v.nkw_hy = (v.nkw_hy ?? query.target_y_rotation) + (query.target_y_rotation - (v.nkw_hy ?? query.target_y_rotation)) * v.nkw_hf;'
    )
    // vanilla already turns the head to the target; we add (smoothed - target)
    anim.head = { rotation: ['v.nkw_hx - query.target_x_rotation', 'v.nkw_hy - query.target_y_rotation', 0] }
  }
  const spring = (prefix: string, bonesList: string[], side: 'front' | 'back', p: { stiffness: number; damping: number; gravity: number; drag: number; sway: number; limitIn: number; limitOut: number }) => {
    const s = side === 'front' ? 1 : -1
    const n = bonesList.length
    pre.push(
      `v.${prefix}ot = ${-s} * v.nkw_vz * ${r4(p.drag)} + math.max(0, -v.nkw_vy) * ${r4(p.drag * 0.6)} + ${s} * v.nkw_pitch * ${r4(p.gravity)};`,
      `v.${prefix}rt = -v.nkw_yawrate * ${r4(p.sway * 4)};`,
      `v.${prefix}po = 0; v.${prefix}pr = 0;`
    )
    bonesList.forEach((b, i) => {
      const o = `v.${prefix}o${i}`, vo = `v.${prefix}vo${i}`, rr = `v.${prefix}r${i}`, vr = `v.${prefix}vr${i}`
      const share = r4(1 / (n - i))
      pre.push(
        `${vo} = ((${vo} ?? 0) + ((v.${prefix}ot - v.${prefix}po) * ${share} - (${o} ?? 0)) * ${r4(p.stiffness)} * v.nkw_dt) * math.pow(${r4(1 - p.damping)}, v.nkw_dt);`,
        `${o} = math.clamp((${o} ?? 0) + ${vo} * v.nkw_dt, ${r4(-p.limitIn * 0.01745)} - v.${prefix}po, ${r4(p.limitOut * 0.01745)} - v.${prefix}po);`,
        `${vr} = ((${vr} ?? 0) + ((v.${prefix}rt - v.${prefix}pr) * ${share} - (${rr} ?? 0)) * ${r4(p.stiffness)} * v.nkw_dt) * math.pow(${r4(1 - p.damping)}, v.nkw_dt);`,
        `${rr} = math.clamp((${rr} ?? 0) + ${vr} * v.nkw_dt, -0.9, 0.9);`,
        `v.${prefix}po = v.${prefix}po + ${o}; v.${prefix}pr = v.${prefix}pr + ${rr};`
      )
      anim[b] = { rotation: [`${o} * ${r4(57.3 * cfg.swingAxis)}`, 0, `${rr} * 57.3`] }
    })
  }
  if (cfg.hairPhysics) chains.forEach((c, i) => spring(`nkw_c${i}`, c.bones, c.hair.side, c.hair.phys))

  // ---- face frame visibility (Bedrock has no action wheel: expressions follow game states) --
  const vis: Json[] = []
  const has = (f: FaceFrame) => !!frameBones[f]
  const blink = cfg.blink && has('blink') ? `(math.mod(query.life_time, ${r4((cfg.blinkMin + cfg.blinkMax) / 2)}) < 0.15 || query.is_sleeping)` : 'query.is_sleeping'
  const states: [FaceFrame, string][] = [
    ['crying', 'query.health <= 4'],
    ['angry', 'query.hurt_time > 0'],
    ['shy', 'query.is_sneaking'],
    ['happy', 'query.is_eating || query.is_celebrating'],
    ['surprised', 'query.is_gliding || (!query.is_on_ground && (query.vertical_speed ?? 0) < -15)']
  ]
  const exprOn = states.filter(([f]) => cfg.expressions && has(f))
  for (const f of inp.faceFrames) if (frameBones[f]) vis.push({ [frameBones[f]!]: false })
  for (const [f, cond] of exprOn) vis.push({ [frameBones[f]!]: `(${cond})` + exprOn.slice(0, exprOn.findIndex((e) => e[0] === f)).map(([, c]) => ` && !(${c})`).join('') })
  if (has('blink')) {
    const covering = exprOn.filter(([f]) => coversEyes(f, cfg)).map(([, c]) => ` && !(${c})`).join('')
    vis.push({ [frameBones.blink!]: blink + covering })
  }

  // ---- client entity (vanilla player, patched) ----------------------------------------------
  const entity = JSON.parse(JSON.stringify(vanillaEntity)) as { 'minecraft:client_entity': { description: Json } }
  const d = entity['minecraft:client_entity'].description as Record<string, any>
  d.textures.nkw = 'textures/nkw/' + id
  d.geometry.nkw = geoId
  d.animations.nkw_motion = 'animation.nkw.' + id
  d.scripts.pre_animation = [...d.scripts.pre_animation, ...pre]
  d.scripts.animate = [...d.scripts.animate, 'nkw_motion']
  const keepVanilla = cfg.hideVanilla === 'used'
  d.render_controllers = (d.render_controllers as Json[]).flatMap((rc) => {
    const key = Object.keys(rc)[0]
    if (key === 'controller.render.player.third_person') {
      const ours = { 'controller.render.player.nkw': rc[key] }
      return keepVanilla ? [{ 'controller.render.player.nkw_vanilla': rc[key] }, ours] : [ours]
    }
    // first-person arms: ours when we replace the whole player, otherwise the player's own
    if (key === 'controller.render.player.first_person' && !keepVanilla) return [{ 'controller.render.player.nkw_first_person': rc[key] }]
    return [rc]
  })

  // ---- render controllers ----------------------------------------------------------------------
  const vrc = (vanillaRc as any).render_controllers
  const third = vrc['controller.render.player.third_person']
  const first = vrc['controller.render.player.first_person']
  const replacedBones = [...replaced].flatMap((p) => [BONE[p], LAYER[p]])
  const rcs: Record<string, Json> = {
    'controller.render.player.nkw': { geometry: 'Geometry.nkw', materials: [{ '*': 'Material.default' }], textures: ['Texture.nkw'], part_visibility: [{ '*': true }, ...vis] },
    // first person keeps the vanilla arm rules but draws our arms
    'controller.render.player.nkw_first_person': { ...first, geometry: 'Geometry.nkw', textures: ['Texture.nkw'] }
  }
  if (keepVanilla) {
    // the player's own skin stays for parts this skin doesn't replace
    rcs['controller.render.player.nkw_vanilla'] = { ...third, part_visibility: [...third.part_visibility, ...replacedBones.map((b) => ({ [b]: false }))] }
    ;(rcs['controller.render.player.nkw'] as any).part_visibility = [{ '*': false }, ...replacedBones.map((b) => ({ [b]: true })), ...Object.values(frameBones).map((b) => ({ [b!]: true })), ...bones.filter((b) => String(b.name).startsWith('nkw_')).map((b) => ({ [String(b.name)]: true })), ...vis]
  }

  const manifest = {
    format_version: 2,
    header: {
      name: inp.name,
      description: inp.description || 'Player model made with NKW Skin & Figura Custom',
      uuid: uuidFrom(inp.packId + ':header'),
      version: [1, 0, Math.floor(Date.now() / 60000) % 65535],
      min_engine_version: [1, 21, 0]
    },
    modules: [{ type: 'resources', uuid: uuidFrom(inp.packId + ':resources'), version: [1, 0, 0] }],
    metadata: { authors: inp.author ? [inp.author] : [], generated_with: { nkw_skin_figura_custom: ['0.1.0'] } }
  }

  return {
    'manifest.json': JSON.stringify(manifest, null, 2),
    'entity/player.entity.json': JSON.stringify(entity, null, 2),
    'render_controllers/nkw.render_controllers.json': JSON.stringify({ format_version: '1.8.0', render_controllers: rcs }, null, 2),
    'models/entity/nkw.geo.json': JSON.stringify(geo, null, 2),
    'animations/nkw.animation.json': JSON.stringify({ format_version: '1.8.0', animations: { ['animation.nkw.' + id]: { loop: true, bones: anim } } }, null, 2)
  }
}

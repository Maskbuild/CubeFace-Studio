import physicsLua from '../../../figura/nkw_physics.lua?raw'
import type { SkinDoc } from '../skin/doc'
import { allFrames, itemView, liveWheel, type FaceFrame } from '../skin/figura'
import { cuboids } from '../skin/layout'
import { cloneImg, composite, createImg, type Img } from '../skin/pixels'
import { dataUrlToImg, imgToDataUrl } from '../lib/png'
import { buildAtlas } from './atlas'
import { usedCuboids, usedHeight } from '../skin/usage'
import { buildModel } from './bbmodel'
import { auriaConf, buildScript } from './script'
import { AURIA_FILES } from './auria'

export interface AvatarMeta {
  name: string
  author: string
  description: string
}

export interface AvatarFiles {
  files: Record<string, string | Uint8Array> // relative path -> content
  /** Estimated size as Figura uploads it (compressed), in bytes. */
  size: number
  breakdown: { texture: number; scripts: number; model: number }
}

async function gzipSize(parts: (string | Uint8Array)[]): Promise<number> {
  if (typeof CompressionStream === 'undefined') return parts.reduce((n, p) => n + (typeof p === 'string' ? p.length : p.byteLength), 0)
  const blob = new Blob(parts as BlobPart[])
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'))
  return (await new Response(stream).arrayBuffer()).byteLength
}

const pngBytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))

/** The whole face as it looks with a frame on: skin face, base frame, then the frame. */
export function faceWithFrame(doc: SkinDoc, frame: FaceFrame): Img {
  const face = doc.faceImage()
  const layers = [face, doc.faces.base, frame === 'base' ? undefined : doc.faces[frame]].filter((x): x is Img => !!x && x.w === face.w)
  const out = createImg(face.w, face.h)
  composite(layers.map((img) => ({ img, visible: true, opacity: 1 })), out)
  return out
}

/** Pictures the exported wheel needs in the atlas (uploads and baked faces): item id -> image. */
export async function wheelIcons(doc: SkinDoc, frames: string[], physics: boolean): Promise<Record<string, Img>> {
  const out: Record<string, Img> = {}
  for (const p of liveWheel(doc.figura, { frames: (f) => frames.includes(f), physics }))
    for (const it of p.items) {
      const ic = itemView(doc.figura, it).icon
      if (ic.kind === 'image') out[it.id] = await dataUrlToImg(ic.src)
      else if (ic.kind === 'face' && (ic.frame === 'base' || doc.faces[ic.frame])) out[it.id] = faceWithFrame(doc, ic.frame)
    }
  return out
}

/**
 * Which skin cuboids go into the avatar. Figura draws the player's own skin for everything
 * else, so by default only the head ships, and only when the smooth head has to move it.
 * Bedrock replaces the whole player, so it keeps every painted part.
 */
export function shippedCuboids(doc: SkinDoc, target: 'figura' | 'bedrock'): boolean[] {
  const used = usedCuboids(doc.composite, doc.variant)
  if (target === 'bedrock' || doc.figura.skinParts === 'all') return used
  const parts = cuboids(doc.variant)
  return used.map((u, i) => u && parts[i].part === 'head' && doc.figura.smoothHead)
}

const hasPhysics = (doc: SkinDoc) => doc.figura.hairPhysics && doc.hair.some((h) => h.visible)

/**
 * Texture atlas shared by the Figura and Bedrock exporters: the skin (cropped to the rows the
 * shipped parts use) with hair planes, face frames and uploaded wheel icons appended below.
 */
export function prepareAtlas(doc: SkinDoc, target: 'figura' | 'bedrock' = 'bedrock', icons: Record<string, Img> = {}) {
  const cfg = doc.figura
  const skin = cloneImg(doc.composite)
  const extras: Record<string, Img> = {}
  for (const h of doc.hair) if (h.visible) extras['hair_' + h.id] = h.img
  const frames = allFrames(cfg).filter((f) => {
    if (!doc.faces[f]) return false
    if (f === 'base') return true
    if (f === 'blink') return cfg.blink
    if (f === 'talk') return cfg.talk
    return cfg.expressions
  })
  for (const f of frames) extras['face_' + f] = doc.faces[f]!
  for (const [id, img] of Object.entries(icons)) extras['icon_' + id] = img

  // ship only the texture rows the shipped parts need (a head-only skin keeps the top quarter)
  const used = shippedCuboids(doc, target)
  const h = usedHeight(doc.composite, doc.variant, used)
  const cropped = h < skin.h ? { w: skin.w, h, data: skin.data.slice(0, skin.w * h * 4) } : skin
  const atlas = buildAtlas(cropped, extras)
  return { atlas, frames, used }
}

/** Build every file of the Figura avatar for a skin. English-only output. */
export async function buildAvatar(doc: SkinDoc, meta: AvatarMeta): Promise<AvatarFiles> {
  const cfg = doc.figura
  const pre = prepareAtlas(doc, 'figura')
  const icons = await wheelIcons(doc, pre.frames, hasPhysics(doc))
  const { atlas, frames, used } = Object.keys(icons).length ? prepareAtlas(doc, 'figura', icons) : pre
  const atlasUrl = imgToDataUrl(atlas.img)
  const { model, info } = buildModel({
    name: meta.name,
    variant: doc.variant,
    res: doc.res,
    atlasW: atlas.img.w,
    atlasH: atlas.img.h,
    atlasDataUrl: atlasUrl,
    slots: atlas.slots,
    hair: doc.hair,
    figura: cfg,
    faceFrames: frames,
    used
  })
  const script = buildScript(meta.name, cfg, info, doc.hair)
  const conf = auriaConf(cfg)
  const usesPhysics = script.includes('require("nkw_physics")')
  const usesAuria = script.includes('require("auria_wheel.main")')
  const files: Record<string, string | Uint8Array> = {
    'avatar.json': JSON.stringify({ name: meta.name, authors: meta.author ? [meta.author] : [], description: meta.description }, null, 2),
    'model.bbmodel': JSON.stringify(model),
    'script.lua': script
  }
  if (usesPhysics) files['nkw_physics.lua'] = physicsLua
  if (usesAuria) Object.assign(files, AURIA_FILES, { 'auria_wheel/conf.lua': conf })

  // Size estimate: Figura stores textures as PNG and models as compact data, then compresses.
  const png = pngBytes(atlasUrl)
  const modelNoTex = JSON.stringify({ ...model, textures: [] })
  const luaParts = Object.entries(files).filter(([p]) => p.endsWith('.lua')).map(([, v]) => v as string)
  const extraBin = Object.entries(files).filter(([p]) => p.startsWith('auria_wheel/') && !p.endsWith('.lua')).map(([, v]) => v)
  const [texture, scriptSize, modelSize] = await Promise.all([gzipSize([png, ...extraBin]), gzipSize(luaParts), gzipSize([modelNoTex])])
  // Figura's binary model is much smaller than Blockbench JSON; ~35% is a conservative ratio
  const model35 = Math.round(modelSize * 0.35)
  return { files, size: texture + scriptSize + model35, breakdown: { texture, scripts: scriptSize, model: model35 } }
}

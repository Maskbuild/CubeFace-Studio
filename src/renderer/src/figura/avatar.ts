import physicsLua from '../../../figura/nkw_physics.lua?raw'
import type { SkinDoc } from '../skin/doc'
import type { FaceFrame } from '../skin/figura'
import { cloneImg, type Img } from '../skin/pixels'
import { imgToDataUrl } from '../lib/png'
import { buildAtlas } from './atlas'
import { usedCuboids, usedHeight } from '../skin/usage'
import { buildModel } from './bbmodel'
import { buildScript } from './script'
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

/**
 * Texture atlas shared by the Figura and Bedrock exporters: the skin (cropped to the used
 * rows) with hair planes and face frames appended below.
 */
export function prepareAtlas(doc: SkinDoc) {
  const cfg = doc.figura
  const skin = cloneImg(doc.composite)
  const extras: Record<string, Img> = {}
  for (const h of doc.hair) if (h.visible) extras['hair_' + h.id] = h.img
  const frames = (Object.keys(doc.faces) as FaceFrame[]).filter((f) => {
    if (f === 'blink') return cfg.blink
    if (f === 'talk') return cfg.talk
    return cfg.expressions
  })
  for (const f of frames) extras['face_' + f] = doc.faces[f]!

  // ship only the texture rows the used parts need (a head-only skin keeps the top quarter)
  const used = usedCuboids(doc.composite, doc.variant)
  const h = usedHeight(doc.composite, doc.variant)
  const cropped = h < skin.h ? { w: skin.w, h, data: skin.data.slice(0, skin.w * h * 4) } : skin
  const atlas = buildAtlas(cropped, extras)
  return { atlas, frames, used }
}

/** Build every file of the Figura avatar for a skin. English-only output. */
export async function buildAvatar(doc: SkinDoc, meta: AvatarMeta): Promise<AvatarFiles> {
  const cfg = doc.figura
  const { atlas, frames, used } = prepareAtlas(doc)
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
  const usesPhysics = script.includes('require("nkw_physics")')
  const usesAuria = script.includes('require("auria_wheel.main")')
  const files: Record<string, string | Uint8Array> = {
    'avatar.json': JSON.stringify({ name: meta.name, authors: meta.author ? [meta.author] : [], description: meta.description }, null, 2),
    'model.bbmodel': JSON.stringify(model),
    'script.lua': script
  }
  if (usesPhysics) files['nkw_physics.lua'] = physicsLua
  if (usesAuria) Object.assign(files, AURIA_FILES)

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

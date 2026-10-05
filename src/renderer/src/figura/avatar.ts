import physicsLua from '../../../figura/nkw_physics.lua?raw'
import type { SkinDoc } from '../skin/doc'
import { extraParts } from '../skin/extras'
import { eyeParts, faceOrigin, sampleFace, type FaceFrame } from '../skin/figura'
import { cloneImg, createImg, fillRect, writeRect, type Img } from '../skin/pixels'
import { parseHex } from '../skin/color'
import { imgToDataUrl } from '../lib/png'
import { buildAtlas } from './atlas'
import { usedCuboids, usedHeight } from '../skin/usage'
import { buildModel } from './bbmodel'
import { buildScript } from './script'

export interface AvatarMeta {
  name: string
  author: string
  description: string
}

export interface AvatarFiles {
  files: Record<string, string> // file name -> text content
  /** Estimated size as Figura uploads it (compressed), in bytes. */
  size: number
  breakdown: { texture: number; scripts: number; model: number }
}

const solid = (hex: string): Img => {
  const img = createImg(2, 2)
  fillRect(img, { x: 0, y: 0, w: 2, h: 2 }, parseHex(hex) ?? [255, 255, 255, 255], 1)
  return img
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
 * rows) with hair, face frames, irises (smooth eyes) and fur colours appended below.
 */
export function prepareAtlas(doc: SkinDoc, opts: { smoothEyes: boolean }) {
  const cfg = doc.figura
  const face = doc.faceImage()
  const skin = cloneImg(doc.composite)
  const extras: Record<string, Img> = {}

  for (const h of doc.hair) if (h.visible) extras['hair_' + h.id] = h.img
  const frames = (Object.keys(doc.faces) as FaceFrame[]).filter((f) => {
    if (f === 'blink') return cfg.blink
    if (f === 'talk') return cfg.talk
    return cfg.expressions
  })
  for (const f of frames) extras['face_' + f] = doc.faces[f]!

  const iris = opts.smoothEyes && cfg.smoothEyes
  if (iris) {
    // irises move on their own planes; under them the skin keeps the eye with the iris
    // pixels swapped for sclera (everything else in the eye box stays as painted)
    const { light } = sampleFace(face, cfg, doc.masks)
    const o = faceOrigin(doc.res)
    for (const [key, r] of [['R', cfg.eyeR], ['L', cfg.eyeL]] as const) {
      const parts = eyeParts(face, r, doc.masks[key === 'R' ? 'eyeR' : 'eyeL'], light, cfg.eyeShift)
      extras['iris_' + key] = parts.iris
      writeRect(skin, { x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h }, parts.base.data)
    }
  }
  const parts = extraParts(cfg.ears, cfg.tail)
  if (parts.length) {
    extras.fur = solid(cfg.furColor)
    extras.inner = solid(cfg.furInner)
  }

  // ship only the texture rows the used parts need (a head-only skin keeps the top quarter)
  const used = usedCuboids(doc.composite, doc.variant)
  const h = usedHeight(doc.composite, doc.variant)
  const cropped = h < skin.h ? { w: skin.w, h, data: skin.data.slice(0, skin.w * h * 4) } : skin
  const atlas = buildAtlas(cropped, extras)
  return { atlas, frames, iris, parts, used }
}

/** Build every file of the Figura avatar for a skin. English-only output. */
export async function buildAvatar(doc: SkinDoc, meta: AvatarMeta): Promise<AvatarFiles> {
  const cfg = doc.figura
  const { atlas, frames, iris, parts, used } = prepareAtlas(doc, { smoothEyes: true })
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
    iris,
    extras: parts,
    used
  })
  const script = buildScript(meta.name, cfg, info, doc.hair)
  const usesPhysics = script.includes('require("nkw_physics")')
  const files: Record<string, string> = {
    'avatar.json': JSON.stringify({ name: meta.name, authors: meta.author ? [meta.author] : [], description: meta.description }, null, 2),
    'model.bbmodel': JSON.stringify(model),
    'script.lua': script
  }
  if (usesPhysics) files['nkw_physics.lua'] = physicsLua

  // Size estimate: Figura stores the texture as PNG and the model as compact data, then compresses.
  const png = pngBytes(atlasUrl)
  const modelNoTex = JSON.stringify({ ...model, textures: [] })
  const scripts = script + (usesPhysics ? physicsLua : '')
  const [texture, scriptSize, modelSize] = await Promise.all([gzipSize([png]), gzipSize([scripts]), gzipSize([modelNoTex])])
  // Figura's binary model is much smaller than Blockbench JSON; ~35% is a conservative ratio
  const model35 = Math.round(modelSize * 0.35)
  return { files, size: texture + scriptSize + model35, breakdown: { texture, scripts: scriptSize, model: model35 } }
}

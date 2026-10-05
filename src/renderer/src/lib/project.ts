import { SkinDoc, type Layer } from '../skin/doc'
import { RESOLUTIONS, type Variant } from '../skin/layout'
import { createImg, type Img } from '../skin/pixels'
import { detectVariant, mannequin, upgradeLegacy } from '../skin/templates'
import { renderThumbnail } from '../three/thumbnail'
import { dataUrlToImg, imgToDataUrl } from './png'
import { storage } from './storage'

export function createDoc(name: string, res: number, variant: Variant, template: 'blank' | 'mannequin', baseName: string): SkinDoc {
  const doc = new SkinDoc({ name, res, variant })
  doc.initLayers([doc.makeLayer(baseName, template === 'mannequin' ? mannequin(res, variant) : createImg(res, res))])
  return doc
}

export type ImportResult = { ok: true; img: Img; variant: Variant; legacy: boolean } | { ok: false; w: number; h: number }

/** Validate and normalise an imported skin image. */
export async function decodeSkin(dataUrl: string): Promise<ImportResult> {
  let img = await dataUrlToImg(dataUrl)
  let legacy = false
  if (img.h * 2 === img.w && (RESOLUTIONS as readonly number[]).includes(img.w)) {
    img = upgradeLegacy(img)
    legacy = true
  }
  if (img.w !== img.h || !(RESOLUTIONS as readonly number[]).includes(img.w)) return { ok: false, w: img.w, h: img.h }
  return { ok: true, img, variant: legacy ? 'wide' : detectVariant(img), legacy }
}

export async function loadDoc(id: string): Promise<SkinDoc | null> {
  const data = await storage.loadSkin(id)
  if (!data) return null
  const p = data.project
  const doc = new SkinDoc({ id: p.id, name: p.name, res: p.res, variant: p.variant, createdAt: p.createdAt })
  const layers: Layer[] = []
  for (const info of p.layers) {
    const url = data.layers[info.id]
    let img = url ? await dataUrlToImg(url) : createImg(p.res, p.res)
    if (img.w !== p.res) img = createImg(p.res, p.res)
    layers.push({ ...info, img })
  }
  doc.initLayers(layers, p.activeLayerId)
  return doc
}

export async function saveDoc(doc: SkinDoc) {
  const layers: Record<string, string> = {}
  for (const l of doc.layers) layers[l.id] = imgToDataUrl(l.img)
  await storage.saveSkin({ project: doc.toJson(), layers, thumb: renderThumbnail(doc.composite, doc.variant) })
  doc.markSaved()
}

export function exportFileName(name: string) {
  return (name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') || 'skin') + '.png'
}

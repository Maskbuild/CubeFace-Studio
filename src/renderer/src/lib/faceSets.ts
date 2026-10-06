import type { SkinDoc } from '../skin/doc'
import type { FaceSetConfig } from '../skin/doc'
import type { FaceFrame } from '../skin/figura'
import { createImg, type Img } from '../skin/pixels'
import { faceWithFrame } from '../figura/avatar'
import { dataUrlToImg, imgToDataUrl } from './png'
import { storage } from './storage'

/**
 * Saved face sets (all expression frames, blink, talk, eye boxes …) shared by every skin,
 * like the wardrobe but for a whole face at once.
 */
export interface FaceSet {
  id: string
  name: string
  createdAt: number
  res: number
  thumb: string // base face, blink and one expression side by side
  frames: Partial<Record<FaceFrame, string>> // PNG data URLs
  config: FaceSetConfig
}

const KEY = 'faceSets'
export const loadFaceSets = async () => (await storage.getGlobal<FaceSet[]>(KEY)) ?? []
export const saveFaceSets = (list: FaceSet[]) => storage.setGlobal(KEY, list)

/** A strip of up to three faces (base, blink, first expression) for the card. */
function thumbOf(doc: SkinDoc): string {
  const shown = (['base', 'blink', 'happy', 'angry'] as FaceFrame[]).filter((f) => f === 'base' || doc.faces[f]).slice(0, 3)
  const n = doc.faceImage().w
  const out = createImg(n * shown.length, n)
  shown.forEach((f, i) => {
    const img = faceWithFrame(doc, f)
    for (let y = 0; y < n; y++) out.data.set(img.data.subarray(y * n * 4, (y + 1) * n * 4), (y * out.w + i * n) * 4)
  })
  return imgToDataUrl(out)
}

export function faceSetFrom(doc: SkinDoc, name: string): FaceSet {
  const frames: FaceSet['frames'] = {}
  for (const [f, img] of Object.entries(doc.faces)) if (img) frames[f as FaceFrame] = imgToDataUrl(img)
  return { id: 'fs' + Date.now().toString(36), name, createdAt: Date.now(), res: doc.faceRes(), thumb: thumbOf(doc), frames, config: structuredClone(doc.faceSetConfig()) }
}

export async function applyFaceSet(doc: SkinDoc, set: FaceSet) {
  const frames: Partial<Record<FaceFrame, Img>> = {}
  for (const [f, url] of Object.entries(set.frames)) if (url) frames[f as FaceFrame] = await dataUrlToImg(url)
  doc.applyFaceSet(set.res, frames, set.config)
}

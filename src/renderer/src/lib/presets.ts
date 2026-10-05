import { newId } from '../skin/doc'
import type { HairInfo, HairPlane } from '../skin/hair'
import { dataUrlToImg, imgToDataUrl } from './png'
import { storage } from './storage'

/** A saved set of Figura extras (currently hair planes) usable on any skin. */
export interface FiguraPreset {
  id: string
  name: string
  createdAt: number
  hair: (Omit<HairInfo, 'presetId'> & { texture: string })[]
}

const KEY = 'figuraPresets'

export const loadPresets = async () => (await storage.getGlobal<FiguraPreset[]>(KEY)) ?? []
export const savePresets = (list: FiguraPreset[]) => storage.setGlobal(KEY, list)

export function presetFromHair(name: string, hair: HairPlane[]): FiguraPreset {
  return {
    id: newId(),
    name,
    createdAt: Date.now(),
    hair: hair.map(({ img, presetId: _p, ...info }) => ({ ...info, texture: imgToDataUrl(img) }))
  }
}

export async function decodePreset(p: FiguraPreset): Promise<HairPlane[]> {
  return Promise.all(p.hair.map(async ({ texture, ...info }) => ({ ...info, img: await dataUrlToImg(texture) })))
}

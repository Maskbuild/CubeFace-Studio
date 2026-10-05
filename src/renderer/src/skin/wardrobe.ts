import type { License, LayerMeta } from './doc'
import type { Variant } from './layout'
import { resample, type Img } from './pixels'
import { applyAdjust, type Adjust } from './recolor'

export type WardrobeCategory = 'outfit' | 'top' | 'bottom' | 'skin' | 'hair' | 'eyes' | 'mouth'
export const CATEGORIES: WardrobeCategory[] = ['outfit', 'top', 'bottom', 'skin', 'hair', 'eyes', 'mouth']
/** Layer order when applied, bottom first: clothes over skin, hair on top. */
export const STACK: WardrobeCategory[] = ['skin', 'eyes', 'mouth', 'bottom', 'top', 'outfit', 'hair']

export interface WardrobeItem {
  id: string
  name: string
  category: WardrobeCategory
  res: number
  variant: Variant
  credit: string
  license: License
  modifyPercent: number
  figuraPresetId?: string // hair items can bring a Figura hair preset along
  createdAt: number
  thumb: string // small 3D render (data URL)
}

export interface Pick {
  item: WardrobeItem
  img: Img
  adjust: Adjust
}

export const itemMeta = (it: WardrobeItem): Partial<LayerMeta> => ({ credit: it.credit, license: it.license, modifyPercent: it.modifyPercent, source: 'wardrobe:' + it.id })

/** Turn picked items into layers (bottom first) at the target resolution, colours applied. */
export function composeLayers(picks: Pick[], res: number): { name: string; img: Img; meta: Partial<LayerMeta> }[] {
  return [...picks]
    .sort((a, b) => STACK.indexOf(a.item.category) - STACK.indexOf(b.item.category))
    .map((p) => ({ name: p.item.name, img: resample(applyAdjust(p.img, p.adjust), res), meta: itemMeta(p.item) }))
}

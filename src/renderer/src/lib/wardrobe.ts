import type { Img } from '../skin/pixels'
import type { WardrobeItem } from '../skin/wardrobe'
import { dataUrlToImg, imgToDataUrl } from './png'
import { storage } from './storage'
import { normCategory } from '../skin/wardrobe'

export * from '../skin/wardrobe'

const KEY = 'wardrobe'
const KIND = 'wardrobe'

export const loadWardrobe = async () => ((await storage.getGlobal<WardrobeItem[]>(KEY)) ?? []).map((it) => ({ ...it, category: normCategory(it.category) }))
export const saveWardrobe = (items: WardrobeItem[]) => storage.setGlobal(KEY, items)

const cache = new Map<string, Img>()
export async function itemImage(id: string): Promise<Img | null> {
  const hit = cache.get(id)
  if (hit) return hit
  const url = await storage.getAsset(KIND, id)
  if (!url) return null
  const img = await dataUrlToImg(url)
  cache.set(id, img)
  return img
}

export async function putItemImage(id: string, img: Img) {
  cache.set(id, img)
  await storage.setAsset(KIND, id, imgToDataUrl(img))
}

export async function deleteItemImage(id: string) {
  cache.delete(id)
  await storage.deleteAsset(KIND, id)
}


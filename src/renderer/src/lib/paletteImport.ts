import { newId } from '../skin/doc'
import { extractPalette, type Palette } from '../skin/palette'
import { dataUrlToImg } from './png'
import { storage } from './storage'

/** Palette from an image's dominant colours. */
export async function paletteFromDataUrl(name: string, dataUrl: string, count = 16): Promise<Palette | null> {
  const colors = extractPalette(await dataUrlToImg(dataUrl), count)
  return colors.length ? { id: newId(), name, colors } : null
}

/** Ask for an image and build a palette from its dominant colours. */
export async function paletteFromImage(count = 16): Promise<Palette | null> {
  const file = await storage.openImage()
  if (!file) return null
  const colors = extractPalette(await dataUrlToImg(file.dataUrl), count)
  return colors.length ? { id: newId(), name: file.name, colors } : null
}

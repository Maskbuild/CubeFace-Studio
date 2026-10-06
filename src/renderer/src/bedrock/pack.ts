import type { SkinDoc } from '../skin/doc'
import { prepareAtlas, type AvatarMeta } from '../figura/avatar'
import { imgToDataUrl } from '../lib/png'
import { zip } from '../lib/zip'
import { renderThumbnail } from '../three/thumbnail'
import { buildBedrockPack } from './build'

const bytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))

/** Build the .mcpack (zip) for a skin. */
export function buildMcpack(doc: SkinDoc, meta: AvatarMeta): Uint8Array {
  const { atlas, frames, used } = prepareAtlas(doc)
  const files = buildBedrockPack({
    name: meta.name,
    author: meta.author,
    description: meta.description,
    packId: doc.id,
    variant: doc.variant,
    atlasW: atlas.img.w,
    atlasH: atlas.img.h,
    slots: atlas.slots,
    hair: doc.hair,
    figura: doc.figura,
    faceFrames: frames,
    faceOnHat: doc.faceOnHat(),
    used
  })
  const id = doc.id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 16) || 'skin'
  return zip([
    ...Object.entries(files).map(([name, data]) => ({ name, data })),
    { name: `textures/nkw/${id}.png`, data: bytes(imgToDataUrl(atlas.img)) },
    { name: 'pack_icon.png', data: bytes(renderThumbnail(doc.composite, doc.variant, 256)) }
  ])
}

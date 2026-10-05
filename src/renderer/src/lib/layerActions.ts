import i18n from '../i18n'
import type { SkinDoc } from '../skin/doc'
import { cloneImg, resample, type Img } from '../skin/pixels'
import { useEditor } from '../store/editor'
import { toast } from '../ui/common/dialogs'
import { decodeSkin, exportFileName } from './project'
import { imgToDataUrl } from './png'
import { storage } from './storage'

/** Decode an image as a skin-format layer at the document resolution (or explain why not). */
async function toLayerImage(doc: SkinDoc, dataUrl: string): Promise<Img | null> {
  const r = await decodeSkin(dataUrl)
  if (!r.ok) {
    toast(i18n.t('home.badSize', { w: r.w, h: r.h }))
    return null
  }
  return r.img.w === doc.res ? r.img : resample(r.img, doc.res)
}

export async function importAsNewLayers(doc: SkinDoc, files?: { name: string; dataUrl: string }[]) {
  if (!files) {
    const f = await storage.openImage()
    files = f ? [f] : []
  }
  for (const f of files) {
    const img = await toLayerImage(doc, f.dataUrl)
    if (img) doc.addLayer(f.name, img)
  }
}

export async function importIntoLayer(doc: SkinDoc, id: string) {
  const f = await storage.openImage()
  if (!f) return
  const img = await toLayerImage(doc, f.dataUrl)
  if (img) doc.replaceLayerPixels(id, img)
}

export function exportLayer(doc: SkinDoc, id: string) {
  const l = doc.layer(id)
  if (l) storage.savePng(imgToDataUrl(l.img), exportFileName(`${doc.name}_${l.name}`))
}

/** Ctrl+C: keep the layer (with name/license) and also put it on the system clipboard as PNG. */
export async function copyLayer(doc: SkinDoc) {
  const l = doc.active
  if (!l) return
  useEditor.getState().set({ clipboard: { name: l.name, img: cloneImg(l.img), meta: { ...l.meta } } })
  try {
    const blob = await (await fetch(imgToDataUrl(l.img))).blob()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  } catch {
    // system clipboard is optional; the in-app copy still works
  }
  toast(i18n.t('layers.copied', { name: l.name }))
}

const same = (a: Img, b: Img) => a.w === b.w && a.h === b.h && a.data.every((v, i) => Math.abs(v - b.data[i]) <= 2)

/**
 * Ctrl+V: an image on the system clipboard becomes a new layer; if it is the layer we copied
 * ourselves, its name and license come along. Without a clipboard image, paste the in-app copy.
 */
export async function pasteLayer(doc: SkinDoc, clipboardImage?: { name: string; dataUrl: string }) {
  const clip = useEditor.getState().clipboard
  if (clipboardImage) {
    const img = await toLayerImage(doc, clipboardImage.dataUrl)
    if (!img) return
    if (clip && same(img, clip.img.w === doc.res ? clip.img : resample(clip.img, doc.res))) doc.addLayer(clip.name + ' copy', cloneImg(img), clip.meta)
    else doc.addLayer(i18n.t('layers.pasted'), img)
    return
  }
  if (clip) doc.addLayer(clip.name + ' copy', clip.img.w === doc.res ? cloneImg(clip.img) : resample(clip.img, doc.res), clip.meta)
}

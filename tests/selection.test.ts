import './_window'
import { describe, expect, it } from 'vitest'
import { SkinDoc } from '../src/renderer/src/skin/doc'
import { createImg, fillRect, getPixel } from '../src/renderer/src/skin/pixels'
import { cancelFloating, commitFloating, copySelection, deleteSelection, fillSelection, liftSelection, moveFloatingTo, pasteFloating, select } from '../src/renderer/src/lib/selection'

const make = () => {
  const doc = new SkinDoc({ name: 't', res: 64, variant: 'wide' })
  const img = createImg(64, 64)
  fillRect(img, { x: 8, y: 8, w: 2, h: 2 }, [255, 0, 0, 255], 1)
  doc.initLayers([doc.makeLayer('base', img)])
  return doc
}
const alpha = (doc: SkinDoc, x: number, y: number) => getPixel(doc.active!.img, x, y)[3]

describe('selection', () => {
  it('moves selected pixels and places them as one undo step', () => {
    const doc = make()
    select({ x: 8, y: 8, w: 2, h: 2 })
    expect(liftSelection(doc)).toBe(true)
    moveFloatingTo(doc, 20, 20)
    expect(alpha(doc, 8, 8)).toBe(0) // the hole it came from
    expect(alpha(doc, 20, 20)).toBe(255) // shown live while floating
    commitFloating(doc)
    expect(alpha(doc, 21, 21)).toBe(255)
    doc.undo()
    expect(alpha(doc, 8, 8)).toBe(255)
    expect(alpha(doc, 20, 20)).toBe(0)
  })
  it('cancel puts everything back', () => {
    const doc = make()
    select({ x: 8, y: 8, w: 2, h: 2 })
    liftSelection(doc)
    moveFloatingTo(doc, 30, 30)
    cancelFloating(doc)
    expect(alpha(doc, 8, 8)).toBe(255)
    expect(alpha(doc, 30, 30)).toBe(0)
  })
  it('copies, pastes at the selection, deletes and fills inside it', () => {
    const doc = make()
    select({ x: 8, y: 8, w: 2, h: 2 })
    expect(copySelection(doc)).toBe(true)
    select({ x: 40, y: 40, w: 2, h: 2 })
    expect(pasteFloating(doc)).toBe(true)
    commitFloating(doc)
    expect(alpha(doc, 41, 41)).toBe(255)
    expect(alpha(doc, 8, 8)).toBe(255) // the original stays
    select({ x: 8, y: 8, w: 1, h: 2 })
    deleteSelection(doc)
    expect(alpha(doc, 8, 8)).toBe(0)
    expect(alpha(doc, 9, 8)).toBe(255)
    select({ x: 0, y: 0, w: 2, h: 2 })
    fillSelection(doc, [0, 0, 255, 255], 1)
    expect(getPixel(doc.active!.img, 1, 1)[2]).toBe(255)
    expect(alpha(doc, 2, 2)).toBe(0)
    select(null)
  })
})

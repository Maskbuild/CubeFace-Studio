import type { SkinDoc } from '../skin/doc'
import { useEditor, type Tool } from '../store/editor'
import { copyLayer, importAsNewLayers } from './layerActions'

/** Shown in the shortcuts dialog (keys, i18n label key). */
export const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: 'general',
    items: [
      ['Ctrl+Z', 'undo'],
      ['Ctrl+Y / Ctrl+Shift+Z', 'redo'],
      ['Ctrl+S', 'save'],
      ['Ctrl+Shift+E', 'exportPng'],
      ['Ctrl+1 / Ctrl+2', 'mode'],
      ['F1 / ?', 'help'],
      ['Esc', 'deselect']
    ]
  },
  {
    group: 'tools',
    items: [
      ['B', 'brush'],
      ['E', 'eraser'],
      ['G', 'bucket'],
      ['I / Alt (hold)', 'picker'],
      ['O / Space (hold)', 'orbit'],
      ['[  ]', 'size'],
      ['Shift+[  ]', 'opacity'],
      ['M', 'mirror'],
      ['H', 'grid'],
      ['P', 'preview']
    ]
  },
  {
    group: 'layers',
    items: [
      ['Ctrl+C', 'copy'],
      ['Ctrl+X', 'cut'],
      ['Ctrl+V', 'paste'],
      ['Ctrl+D', 'duplicate'],
      ['Ctrl+Shift+N', 'newLayer'],
      ['Ctrl+O', 'import'],
      ['Ctrl+E', 'mergeDown'],
      ['Ctrl+↑ / Ctrl+↓', 'moveLayer'],
      ['F2', 'rename'],
      ['Delete', 'deleteLayer']
    ]
  }
]

const TOOL_KEYS: Record<string, Tool> = { b: 'brush', e: 'eraser', g: 'bucket', i: 'picker', o: 'orbit' }

interface Actions {
  save(): void
  exportPng(): void
  help(): void
  newLayerName(): string
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/** Keyboard handling for the editor. Returns a cleanup function. */
export function bindShortcuts(doc: SkinDoc, a: Actions): () => void {
  let altPrev: Tool | null = null
  const st = () => useEditor.getState()

  const down = (e: KeyboardEvent) => {
    if (typing(e.target) || document.querySelector('.modal-back')) return
    const k = e.key.toLowerCase()
    const ctrl = e.ctrlKey || e.metaKey
    const s = st()
    const layer = doc.active
    const run = (fn: () => void) => {
      e.preventDefault()
      fn()
    }
    if (ctrl) {
      if (k === 'z') return run(() => (e.shiftKey ? doc.redo() : doc.undo()))
      if (k === 'y') return run(() => doc.redo())
      if (k === 's') return run(a.save)
      if (k === 'e' && e.shiftKey) return run(a.exportPng)
      if (k === 'e') return run(() => layer && doc.mergeDown(layer.id))
      if (k === 'c') return run(() => copyLayer(doc))
      if (k === 'x') return run(async () => {
        if (!layer || doc.layers.length <= 1) return
        await copyLayer(doc)
        doc.removeLayer(layer.id)
      })
      // Ctrl+V is handled by the paste event (it can read images from the clipboard)
      if (k === 'd') return run(() => layer && doc.duplicateLayer(layer.id))
      if (k === 'n' && e.shiftKey) return run(() => doc.addLayer(a.newLayerName()))
      if (k === 'o') return run(() => importAsNewLayers(doc))
      if (k === 'arrowup') return run(() => layer && doc.moveLayer(layer.id, 1))
      if (k === 'arrowdown') return run(() => layer && doc.moveLayer(layer.id, -1))
      if (k === '1') return run(() => (doc.selectFace(null), s.set({ mode: 'skin' })))
      if (k === '2') return run(() => s.set({ mode: 'figura' }))
      return
    }
    if (e.key === 'Alt') {
      e.preventDefault()
      if (!altPrev && s.tool !== 'picker') {
        altPrev = s.tool
        s.set({ tool: 'picker' })
      }
      return
    }
    if (e.key === 'F1' || e.key === '?') return run(a.help)
    if (e.key === 'F2') return run(() => layer && s.set({ renameLayerId: layer.id }))
    if (e.key === 'Delete') return run(() => layer && doc.removeLayer(layer.id))
    if (e.key === 'Escape') return run(() => (doc.selectHair(null), doc.selectFace(null)))
    if (e.altKey) return
    if (TOOL_KEYS[k]) return run(() => s.set({ tool: TOOL_KEYS[k] }))
    if (k === 'm') return run(() => s.set({ mirror: !s.mirror }))
    if (k === 'h') return run(() => s.set({ grid: !s.grid }))
    if (k === 'p') return run(() => s.set({ preview: !s.preview }))
    if (e.key === '[' || e.key === ']' || e.key === '{' || e.key === '}') {
      const up = e.key === ']' || e.key === '}'
      const b = s.tool === 'eraser' ? s.eraser : s.brush
      return run(() =>
        e.shiftKey ? s.setBrush({ opacity: Math.round(Math.min(1, Math.max(0.05, b.opacity + (up ? 0.1 : -0.1))) * 100) / 100 }) : s.setBrush({ size: Math.max(1, b.size + (up ? 1 : -1)) })
      )
    }
  }

  const up = (e: KeyboardEvent) => {
    if (e.key === 'Alt' && altPrev) {
      st().set({ tool: altPrev })
      altPrev = null
    }
  }
  // releasing Alt outside the window must still restore the tool
  const blur = () => {
    if (altPrev) st().set({ tool: altPrev })
    altPrev = null
  }

  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  window.addEventListener('blur', blur)
  return () => {
    window.removeEventListener('keydown', down)
    window.removeEventListener('keyup', up)
    window.removeEventListener('blur', blur)
  }
}

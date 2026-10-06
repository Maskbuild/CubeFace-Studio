/*
 * Reads the item list, models and textures out of a Minecraft client jar, keeping only what
 * item icons need. The result ("McPack") is cached by the app; nothing is redistributed.
 */

export const MC_VERSIONS = ['1.20.1', '1.21.1', '1.21.4'] as const
export type McVersion = (typeof MC_VERSIONS)[number]

export interface McItem {
  id: string // without the "minecraft:" namespace
  name: string // English name from en_us.json
  model: string // e.g. "item/diamond_sword", "block/stone"
  /** Tint colour per tint index (0xRRGGBB), when the item is coloured in code. */
  tints?: number[]
}

export interface McModel {
  parent?: string
  textures?: Record<string, string>
  elements?: McElement[]
  display?: Record<string, { rotation?: number[]; translation?: number[]; scale?: number[] }>
  gui_light?: 'front' | 'side'
}
export interface McElement {
  from: number[]
  to: number[]
  rotation?: { origin: number[]; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean }
  shade?: boolean
  faces: Partial<Record<McFaceName, { uv?: number[]; texture: string; rotation?: number; tintindex?: number }>>
}
export type McFaceName = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'

export interface McPack {
  format: 1
  version: McVersion
  items: McItem[]
  models: Record<string, McModel>
  /** texture path (e.g. "item/apple") -> PNG as base64 */
  textures: Record<string, string>
}

// ---- zip ------------------------------------------------------------------------------------
interface ZipEntry {
  method: number
  csize: number
  offset: number
}

function zipEntries(buf: Uint8Array): Map<string, ZipEntry> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let e = buf.length - 22
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--
  if (e < 0) throw new Error('not a zip/jar file')
  const n = dv.getUint16(e + 10, true)
  let p = dv.getUint32(e + 16, true)
  const dec = new TextDecoder()
  const out = new Map<string, ZipEntry>()
  for (let i = 0; i < n; i++) {
    const nl = dv.getUint16(p + 28, true)
    const xl = dv.getUint16(p + 30, true)
    const cl = dv.getUint16(p + 32, true)
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nl))
    out.set(name, { method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), offset: dv.getUint32(p + 42, true) })
    p += 46 + nl + xl + cl
  }
  return out
}

async function inflate(buf: Uint8Array, ent: ZipEntry): Promise<Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const start = ent.offset + 30 + dv.getUint16(ent.offset + 26, true) + dv.getUint16(ent.offset + 28, true)
  const data = buf.slice(start, start + ent.csize)
  if (ent.method === 0) return data
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const strip = (s: string) => s.replace(/^minecraft:/, '')

// ---- tints that the game applies in code ------------------------------------------------------
const GRASS = 0x91bd59
const FOLIAGE = 0x77ab2f
function legacyTints(id: string): number[] | undefined {
  if (id === 'birch_leaves') return [0x80a755]
  if (id === 'spruce_leaves') return [0x619961]
  if (/leaves$/.test(id) && !/cherry|azalea/.test(id)) return [FOLIAGE]
  if (/^(grass_block|grass|short_grass|tall_grass|fern|large_fern|vine|sugar_cane)$/.test(id)) return [GRASS]
  if (id === 'lily_pad') return [0x208030]
  if (/^leather_(helmet|chestplate|leggings|boots|horse_armor)$/.test(id)) return [0xa06540]
  if (/^(potion|splash_potion|lingering_potion|tipped_arrow)$/.test(id)) return [0xf800f8]
  return undefined
}

/** 1.21.4+ item definitions: follow the default branch down to a plain model. */
function pickModel(node: unknown): { model: string; tints?: number[] } | null {
  if (!node || typeof node !== 'object') return null
  const n = node as Record<string, unknown>
  const type = strip(String(n.type ?? ''))
  if (type === 'model') {
    const tints = Array.isArray(n.tints)
      ? (n.tints as Record<string, unknown>[]).map((t) => {
          const tt = strip(String(t.type ?? ''))
          if (tt === 'grass') return GRASS
          if (tt === 'foliage') return FOLIAGE
          const v = (t.value ?? t.default) as number | number[] | undefined
          if (Array.isArray(v)) return (Math.round(v[0] * 255) << 16) | (Math.round(v[1] * 255) << 8) | Math.round(v[2] * 255)
          return typeof v === 'number' ? v & 0xffffff : 0xffffff
        })
      : undefined
    return { model: strip(String(n.model)), tints }
  }
  if (type === 'special') return { model: strip(String(n.base)) }
  const order: unknown[] = []
  if (type === 'condition') order.push(n.on_false, n.on_true)
  if (n.fallback) order.push(n.fallback)
  if (Array.isArray(n.cases)) order.push(...(n.cases as { model: unknown }[]).map((c) => c.model))
  if (Array.isArray(n.entries)) order.push(...(n.entries as { model: unknown }[]).map((c) => c.model))
  if (Array.isArray(n.models)) order.push(...(n.models as unknown[]))
  for (const o of order) {
    const r = pickModel(o)
    if (r) return r
  }
  return null
}

/** Extract everything item icons need from a client jar. */
export async function extractPack(jar: Uint8Array, version: McVersion): Promise<McPack> {
  const es = zipEntries(jar)
  const dec = new TextDecoder()
  const A = 'assets/minecraft/'
  const readJson = async <T>(p: string): Promise<T | null> => {
    const e = es.get(A + p)
    if (!e) return null
    try {
      return JSON.parse(dec.decode(await inflate(jar, e))) as T
    } catch {
      return null
    }
  }
  const lang = (await readJson<Record<string, string>>('lang/en_us.json')) ?? {}
  const nameOf = (id: string) => lang['item.minecraft.' + id] ?? lang['block.minecraft.' + id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  const items: McItem[] = []
  const defs = [...es.keys()].filter((k) => k.startsWith(A + 'items/') && k.endsWith('.json'))
  if (defs.length) {
    for (const k of defs) {
      const id = k.slice((A + 'items/').length, -5)
      const def = await readJson<{ model: unknown }>('items/' + id + '.json')
      const m = def && pickModel(def.model)
      if (m) items.push({ id, name: nameOf(id), model: m.model, tints: m.tints })
    }
  } else {
    // older versions: every item has models/item/<id>.json and a translated name
    for (const k of es.keys()) {
      const m = /^assets\/minecraft\/models\/item\/([a-z0-9_]+)\.json$/.exec(k)
      if (!m) continue
      const id = m[1]
      if (!lang['item.minecraft.' + id] && !lang['block.minecraft.' + id]) continue
      items.push({ id, name: nameOf(id), model: 'item/' + id, tints: legacyTints(id) })
    }
  }
  items.sort((a, b) => a.id.localeCompare(b.id))

  // models along every parent chain, then the textures they reference
  const models: Record<string, McModel> = {}
  const texRefs = new Set<string>()
  const loadModel = async (ref: string) => {
    let cur: string | undefined = strip(ref)
    while (cur && !cur.startsWith('builtin/') && !models[cur]) {
      const m: McModel | null = await readJson<McModel>(`models/${cur}.json`)
      if (!m) break
      models[cur] = m
      for (const t of Object.values(m.textures ?? {})) if (!t.startsWith('#')) texRefs.add(strip(t))
      cur = m.parent ? strip(m.parent) : undefined
    }
  }
  for (const it of items) await loadModel(it.model)

  const textures: Record<string, string> = {}
  for (const t of texRefs) {
    const e = es.get(`${A}textures/${t}.png`)
    if (e) textures[t] = toBase64(await inflate(jar, e))
  }
  return { format: 1, version, items: items.filter((i) => models[i.model] || i.model.startsWith('builtin/')), models, textures }
}

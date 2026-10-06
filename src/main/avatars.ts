import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import zlib from 'node:zlib'
import { createExtractorFromData } from 'node-unrar-js'

/** A Figura avatar folder kept in the app's avatar library (global/avatars/<id>/files). */
export interface AvatarMeta {
  id: string
  name: string
  authors: string[]
  description: string
  files: number
  bytes: number
  importedAt: number
  thumb: string | null
  /** 3D render of the model (made by the app after import). */
  thumb3d?: string
  /** User-made category ("" / missing = none). */
  category?: string
  /** Where it came from and what may be done with it (set after import). */
  rights?: { source: 'free' | 'bought' | 'own' | 'exclusive'; commercial: boolean; redistribute: boolean; modify: 'yes' | 'limited' | 'no' }
}

const THUMB_MAX = 400_000

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

async function listFiles(root: string, rel = ''): Promise<string[]> {
  const out: string[] = []
  for (const ent of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
    const r = path.join(rel, ent.name)
    if (ent.isDirectory()) out.push(...(await listFiles(root, r)))
    else out.push(r)
  }
  return out
}

/** Thumbnail: the first texture embedded in a .bbmodel, else the first small PNG. */
async function findThumb(dir: string, files: string[]): Promise<string | null> {
  for (const f of files.filter((f) => f.toLowerCase().endsWith('.bbmodel'))) {
    const m = await readJson<{ textures?: { source?: string }[] }>(path.join(dir, f))
    const src = m?.textures?.find((t) => t.source?.startsWith('data:image'))?.source
    if (src && src.length < THUMB_MAX) return src
  }
  for (const f of files.filter((f) => f.toLowerCase().endsWith('.png'))) {
    const buf = await fs.readFile(path.join(dir, f))
    if (buf.length < THUMB_MAX * 0.75) return 'data:image/png;base64,' + buf.toString('base64')
  }
  return null
}

export class AvatarLibrary {
  constructor(private root: string) {}

  private dir(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('invalid avatar id')
    return path.join(this.root, id)
  }

  async list(): Promise<AvatarMeta[]> {
    await fs.mkdir(this.root, { recursive: true })
    const out: AvatarMeta[] = []
    for (const id of await fs.readdir(this.root)) {
      const m = await readJson<AvatarMeta>(path.join(this.root, id, 'meta.json'))
      if (m) out.push(m)
    }
    return out.sort((a, b) => b.importedAt - a.importedAt)
  }

  /** Copy an avatar folder into the library. Returns null if it doesn't look like an avatar. */
  /**
   * Import whatever was dropped or picked: an avatar folder, a folder holding several avatar
   * folders, or a .zip of an avatar (as shared online). Returns every avatar added.
   */
  async importAny(src: string): Promise<AvatarMeta[]> {
    const st = await fs.stat(src).catch(() => null)
    if (!st) return []
    if (st.isFile() && /\.(zip|rar)$/i.test(src)) {
      const tmp = path.join(os.tmpdir(), 'nkw-avatar-' + randomUUID())
      try {
        const buf = await fs.readFile(src)
        if (/\.rar$/i.test(src)) await extractRar(buf, tmp)
        else await extractZip(buf, tmp)
        const roots = await findAvatarRoots(tmp)
        const out: AvatarMeta[] = []
        for (const r of roots) {
          const m = await this.import(r, roots.length === 1 && r === tmp ? path.basename(src, path.extname(src)) : undefined)
          if (m) out.push(m)
        }
        return out
      } finally {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
      }
    }
    if (!st.isDirectory()) return []
    if (await isAvatarDir(src)) {
      const m = await this.import(src)
      return m ? [m] : []
    }
    // a folder of avatars (e.g. Figura's own avatars folder)
    const out: AvatarMeta[] = []
    for (const ent of await fs.readdir(src, { withFileTypes: true })) {
      const p = path.join(src, ent.name)
      if (ent.isDirectory() && (await isAvatarDir(p))) {
        const m = await this.import(p)
        if (m) out.push(m)
      } else if (ent.isFile() && /\.(zip|rar)$/i.test(ent.name)) out.push(...(await this.importAny(p)))
    }
    return out
  }

  async import(src: string, fallbackName?: string): Promise<AvatarMeta | null> {
    const st = await fs.stat(src).catch(() => null)
    if (!st?.isDirectory()) return null
    const files = await listFiles(src)
    const lower = files.map((f) => f.toLowerCase())
    if (!lower.includes('avatar.json') && !lower.some((f) => f.endsWith('.bbmodel') || f.endsWith('.lua'))) return null
    const id = randomUUID()
    const dest = path.join(this.dir(id), 'files')
    await fs.cp(src, dest, { recursive: true })
    const info = (await readJson<Record<string, unknown>>(path.join(dest, 'avatar.json'))) ?? {}
    const a = info.authors ?? info.author
    let bytes = 0
    for (const f of files) bytes += (await fs.stat(path.join(dest, f))).size
    const meta: AvatarMeta = {
      id,
      name: typeof info.name === 'string' && info.name ? info.name : (fallbackName ?? path.basename(src)),
      authors: (Array.isArray(a) ? a : a ? [a] : []).map(String),
      description: typeof info.description === 'string' ? info.description : '',
      files: files.length,
      bytes,
      importedAt: Date.now(),
      thumb: await findThumb(dest, files)
    }
    await fs.writeFile(path.join(this.dir(id), 'meta.json'), JSON.stringify(meta, null, 2))
    return meta
  }

  async update(id: string, patch: Partial<Pick<AvatarMeta, 'name' | 'category' | 'thumb3d' | 'rights'>>) {
    const file = path.join(this.dir(id), 'meta.json')
    const m = await readJson<AvatarMeta>(file)
    if (m) await fs.writeFile(file, JSON.stringify({ ...m, ...patch }, null, 2))
  }

  /** Copy avatars into `parent`, each in its own folder named after the avatar (made unique). */
  async copyTo(ids: string[], parent: string): Promise<string[]> {
    const metas = await this.list()
    const out: string[] = []
    for (const id of ids) {
      const m = metas.find((x) => x.id === id)
      if (!m) continue
      const safe = m.name.replace(/[^\w\- ]+/g, '').trim() || 'avatar'
      let dest = path.join(parent, safe)
      for (let n = 2; await fs.stat(dest).then(() => true, () => false); n++) dest = path.join(parent, `${safe} ${n}`)
      await fs.cp(this.filesDir(id), dest, { recursive: true })
      out.push(dest)
    }
    return out
  }

  /** Every file of an avatar (relative paths, forward slashes) with its size. */
  async files(id: string): Promise<{ path: string; size: number }[]> {
    const dir = this.filesDir(id)
    const out = []
    for (const rel of await listFiles(dir)) out.push({ path: rel.split(path.sep).join('/'), size: (await fs.stat(path.join(dir, rel))).size })
    return out
  }

  /** Read one file: images as data URLs, everything else as text. Paths can't leave the avatar. */
  async read(id: string, rel: string): Promise<string | null> {
    const dir = this.filesDir(id)
    const file = path.resolve(dir, rel)
    if (!file.startsWith(path.resolve(dir) + path.sep)) return null
    const buf = await fs.readFile(file).catch(() => null)
    if (!buf) return null
    const ext = path.extname(file).slice(1).toLowerCase()
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,` + buf.toString('base64')
    return buf.length > 8_000_000 ? null : buf.toString('utf8')
  }

  filesDir(id: string) {
    return path.join(this.dir(id), 'files')
  }

  libDir(id: string) {
    return this.dir(id)
  }
}

/** How an included avatar is credited in avatar.json: "<authors> - <avatar name>". */
export const creditLine = (authors: string[], name: string) => `${authors.filter(Boolean).join(', ') || 'Unknown'} - ${name}`

export type MergeSource = { dir: string; label: string } | { files: Record<string, string | Uint8Array>; label: string }

/** Figura's name for a file: path without the extension, folders joined with dots. */
const figuraId = (rel: string, ext: string) => rel.slice(0, rel.length - ext.length).split(/[\\/]/).join('.')
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Point a script at renamed files: models.<model>, models["<model>"], textures["<model>.<tex>"]
 * and require("<script>") follow the new names, so a merged avatar keeps working.
 */
export function rewriteRefs(lua: string, models: Map<string, string>, scripts: Map<string, string>): string {
  let out = lua
  // longest first, so "model" doesn't eat "model_extra"
  for (const [from, to] of [...models].sort((x, y) => y[0].length - x[0].length)) {
    const f = escapeRe(from)
    out = out
      .replace(new RegExp(`\\bmodels\\.${f}(?![\\w])`, 'g'), `models.${to}`)
      .replace(new RegExp(`\\bmodels\\[(["'])${f}\\1\\]`, 'g'), `models[$1${to}$1]`)
      .replace(new RegExp(`\\btextures\\[(["'])${f}\\.`, 'g'), `textures[$1${to}.`)
  }
  for (const [from, to] of [...scripts].sort((x, y) => y[0].length - x[0].length)) {
    const forms = [from, from.split('.').join('/')]
    for (const form of forms)
      out = out.replace(new RegExp(`\\brequire\\s*\\(?\\s*(["'])(\\.?/?)${escapeRe(form)}\\1`, 'g'), `require($1${to}$1`)
  }
  return out
}

/**
 * Merge avatars into `out` so they run together. Every file keeps its relative path; a clash
 * gets "_2", "_3"… and that avatar's scripts are rewritten to the new model / script names.
 * avatar.json files are combined: the first source's name and authors are kept (the owner),
 * then every other avatar is credited as "<authors> - <avatar name>"; autoScripts lists are
 * joined (an avatar without one contributes all of its scripts).
 */
export async function mergeAvatars(out: string, sources: MergeSource[]) {
  await fs.mkdir(out, { recursive: true })
  const taken = new Set<string>()
  for (const f of await listFiles(out)) taken.add(f.toLowerCase())
  const renamed: { from: string; to: string }[] = []
  let first: Record<string, unknown> | null = null
  const authors = new Set<string>()
  const autoScripts = new Set<string>()
  let anyAuto = false
  const takeInfo = (j: Record<string, unknown> | null, label: string) => {
    const a = j?.authors ?? j?.author
    const list = (Array.isArray(a) ? a : a ? [a] : []).map(String).filter(Boolean)
    if (!first) {
      first = j ?? { name: label }
      for (const x of list) authors.add(x)
    } else authors.add(creditLine(list, typeof j?.name === 'string' && j.name ? j.name : label))
  }
  const reserve = (rel: string) => {
    let target = rel
    const ext = path.extname(rel)
    for (let n = 2; taken.has(target.toLowerCase()); n++) target = rel.slice(0, rel.length - ext.length) + '_' + n + ext
    taken.add(target.toLowerCase())
    return target
  }
  for (const s of sources) {
    // read the source's files
    const files: { rel: string; data: Buffer }[] = []
    if ('dir' in s) for (const rel of await listFiles(s.dir)) files.push({ rel, data: await fs.readFile(path.join(s.dir, rel)) })
    else for (const [rel, data] of Object.entries(s.files)) files.push({ rel, data: typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data) })
    const infoFile = files.find((f) => f.rel.toLowerCase() === 'avatar.json')
    let info: Record<string, unknown> | null = null
    try {
      info = infoFile ? JSON.parse(infoFile.data.toString('utf8')) : null
    } catch {
      info = null
    }
    takeInfo(info, s.label)
    // decide every new name first, then write (scripts need the full rename map)
    const models = new Map<string, string>()
    const scripts = new Map<string, string>()
    const targets = new Map<string, string>()
    for (const f of files) {
      if (f === infoFile) continue
      const target = reserve(f.rel)
      targets.set(f.rel, target)
      if (target !== f.rel) renamed.push({ from: `${s.label}/${f.rel}`, to: target })
      const ext = path.extname(f.rel).toLowerCase()
      if (ext === '.bbmodel' && target !== f.rel) models.set(figuraId(f.rel, '.bbmodel'), figuraId(target, '.bbmodel'))
      if (ext === '.lua') scripts.set(figuraId(f.rel, '.lua'), figuraId(target, '.lua'))
    }
    for (const f of files) {
      if (f === infoFile) continue
      const target = targets.get(f.rel)!
      let data: Buffer | string = f.data
      if (path.extname(f.rel).toLowerCase() === '.lua') {
        const changed = new Map([...scripts].filter(([x, y]) => x !== y))
        if (models.size || changed.size) data = rewriteRefs(f.data.toString('utf8'), models, changed)
      }
      await fs.mkdir(path.dirname(path.join(out, target)), { recursive: true })
      await fs.writeFile(path.join(out, target), data)
    }
    // scripts that run on load
    const own = Array.isArray(info?.autoScripts) ? (info!.autoScripts as unknown[]).map(String) : null
    if (own) anyAuto = true
    for (const name of own ?? [...scripts.keys()]) autoScripts.add(scripts.get(name.replace(/\.lua$/i, '').split('/').join('.')) ?? name)
  }
  const merged: Record<string, unknown> = { ...(first ?? { name: 'Merged avatar' }), authors: [...authors] }
  delete merged.author
  if (anyAuto) merged.autoScripts = [...autoScripts]
  else delete merged.autoScripts
  await fs.writeFile(path.join(out, 'avatar.json'), JSON.stringify(merged, null, 2))
  return { out, count: sources.length, renamed }
}

/** A folder Figura would load as an avatar. */
async function isAvatarDir(dir: string): Promise<boolean> {
  const names = await fs.readdir(dir).catch(() => [] as string[])
  return names.some((n) => n.toLowerCase() === 'avatar.json')
}

/** Folders inside an extracted zip that hold an avatar (the zip root itself, or one level down). */
async function findAvatarRoots(root: string): Promise<string[]> {
  if (await isAvatarDir(root)) return [root]
  const out: string[] = []
  for (const ent of await fs.readdir(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const p = path.join(root, ent.name)
    if (await isAvatarDir(p)) out.push(p)
    else for (const sub of await fs.readdir(p, { withFileTypes: true })) if (sub.isDirectory() && (await isAvatarDir(path.join(p, sub.name)))) out.push(path.join(p, sub.name))
  }
  if (!out.length) {
    // no avatar.json: accept a zip whose files are models/scripts
    const files = await listFiles(root)
    if (files.some((f) => /\.(bbmodel|lua)$/i.test(f))) return [root]
  }
  return out
}

/** Minimal zip reader (stored / deflate) that refuses paths escaping the target folder. */
export async function extractZip(buf: Buffer, dest: string) {
  let e = buf.length - 22
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--
  if (e < 0) throw new Error('not a zip file')
  const count = buf.readUInt16LE(e + 10)
  let p = buf.readUInt32LE(e + 16)
  const root = path.resolve(dest)
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32)
    const lo = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nl).replace(/\\/g, '/')
    p += 46 + nl + xl + cl
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue
    const out = path.resolve(root, name)
    if (!out.startsWith(root + path.sep)) continue // zip-slip guard
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28)
    const raw = buf.subarray(start, start + csize)
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null
    if (!data) continue
    await fs.mkdir(path.dirname(out), { recursive: true })
    await fs.writeFile(out, data)
  }
}

/** Extract a .rar archive (node-unrar-js, WebAssembly), with the same path guard as zips. */
export async function extractRar(buf: Buffer, dest: string) {
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const extractor = await createExtractorFromData({ data })
  const { files } = extractor.extract()
  const root = path.resolve(dest)
  for (const f of files) {
    if (f.fileHeader.flags.directory || !f.extraction) continue
    const name = f.fileHeader.name.replace(/\\/g, '/')
    const out = path.resolve(root, name)
    if (!out.startsWith(root + path.sep)) continue // path-escape guard
    await fs.mkdir(path.dirname(out), { recursive: true })
    await fs.writeFile(out, f.extraction)
  }
}

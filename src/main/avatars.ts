import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

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
  async import(src: string): Promise<AvatarMeta | null> {
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
      name: typeof info.name === 'string' && info.name ? info.name : path.basename(src),
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

  async update(id: string, patch: Partial<Pick<AvatarMeta, 'name'>>) {
    const file = path.join(this.dir(id), 'meta.json')
    const m = await readJson<AvatarMeta>(file)
    if (m) await fs.writeFile(file, JSON.stringify({ ...m, ...patch }, null, 2))
  }

  filesDir(id: string) {
    return path.join(this.dir(id), 'files')
  }

  libDir(id: string) {
    return this.dir(id)
  }
}

export type MergeSource = { dir: string; label: string } | { files: Record<string, string>; label: string }

/**
 * Merge avatars into `out`. Every file keeps its relative path; a clash gets "_2", "_3"…
 * avatar.json files are combined (first name kept, authors joined).
 */
export async function mergeAvatars(out: string, sources: MergeSource[]) {
  await fs.mkdir(out, { recursive: true })
  const taken = new Set<string>()
  for (const f of await listFiles(out)) taken.add(f.toLowerCase())
  const renamed: { from: string; to: string }[] = []
  let first: Record<string, unknown> | null = null
  const authors = new Set<string>()
  const place = async (label: string, rel: string, write: (target: string) => Promise<void>) => {
    let target = rel
    const ext = path.extname(rel)
    for (let n = 2; taken.has(target.toLowerCase()); n++) target = rel.slice(0, rel.length - ext.length) + '_' + n + ext
    if (target !== rel) renamed.push({ from: `${label}/${rel}`, to: target })
    taken.add(target.toLowerCase())
    await fs.mkdir(path.dirname(path.join(out, target)), { recursive: true })
    await write(path.join(out, target))
  }
  const takeInfo = (j: Record<string, unknown> | null) => {
    if (!j) return
    first ??= j
    const a = j.authors ?? j.author
    for (const x of Array.isArray(a) ? a : a ? [a] : []) authors.add(String(x))
  }
  for (const s of sources) {
    if ('dir' in s) {
      for (const rel of await listFiles(s.dir)) {
        if (rel.toLowerCase() === 'avatar.json') takeInfo(await readJson(path.join(s.dir, rel)))
        else await place(s.label, rel, (t) => fs.copyFile(path.join(s.dir, rel), t))
      }
    } else {
      for (const [rel, text] of Object.entries(s.files)) {
        if (rel.toLowerCase() === 'avatar.json') takeInfo(JSON.parse(text))
        else await place(s.label, rel, (t) => fs.writeFile(t, text, 'utf8'))
      }
    }
  }
  const merged: Record<string, unknown> = { ...(first ?? { name: 'Merged avatar' }), authors: [...authors] }
  delete merged.author
  await fs.writeFile(path.join(out, 'avatar.json'), JSON.stringify(merged, null, 2))
  return { out, count: sources.length, renamed }
}

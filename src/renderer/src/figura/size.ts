/*
 * Upload size as Figura counts it. Checked against an avatar Figura 0.1.6 showed as 40.33 KiB
 * (estimate within 0.1%): textures are stored as the PNG bytes found in the models, scripts
 * are minified and compressed together, and Figura's binary model data is about a quarter of
 * the compressed Blockbench JSON.
 */

/** Gzip size of the parts joined (byte length when CompressionStream is missing). */
export async function gzipSize(parts: (string | Uint8Array)[]): Promise<number> {
  if (typeof CompressionStream === 'undefined') return parts.reduce((n, p) => n + (typeof p === 'string' ? p.length : p.byteLength), 0)
  const blob = new Blob(parts as BlobPart[])
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'))
  return (await new Response(stream).arrayBuffer()).byteLength
}

/** Lua without comments and indentation (roughly what Figura uploads). */
export function minifyLua(s: string): string {
  return s
    .replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '')
    .replace(/--[^\n]*/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
}

const base64Len = (dataUrl: string) => {
  const b = dataUrl.slice(dataUrl.indexOf(',') + 1).replace(/=+$/, '')
  return Math.floor((b.length * 3) / 4)
}

export interface FiguraSize {
  texture: number
  scripts: number
  model: number
  total: number
}

/** Estimate from an avatar's files (only .lua and .bbmodel count; text or bytes). */
export async function figuraSize(files: Record<string, string | Uint8Array>): Promise<FiguraSize> {
  const text = (v: string | Uint8Array) => (typeof v === 'string' ? v : new TextDecoder().decode(v))
  const lua: string[] = []
  const models: string[] = []
  let texture = 0
  for (const [p, v] of Object.entries(files)) {
    const low = p.toLowerCase()
    if (low.endsWith('.lua')) lua.push(minifyLua(text(v)) + '\n')
    else if (low.endsWith('.bbmodel')) {
      try {
        const j = JSON.parse(text(v)) as { textures?: { source?: string }[]; elements?: unknown; outliner?: unknown; animations?: unknown }
        for (const tx of j.textures ?? []) if (tx.source?.startsWith('data:')) texture += base64Len(tx.source)
        models.push(JSON.stringify({ e: j.elements, o: j.outliner, a: j.animations }))
      } catch {
        // not a readable model: skip it
      }
    }
  }
  const [scripts, modelGz] = await Promise.all([lua.length ? gzipSize(lua) : 0, models.length ? gzipSize(models) : 0])
  const model = Math.round(modelGz * 0.25)
  return { texture, scripts, model, total: texture + scripts + model }
}

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/*
 * Minecraft client jars, used only to read item textures/models for icon previews.
 * Nothing from Minecraft is bundled with the app: the jar comes from a launcher already on
 * this computer (Prism Launcher, the official launcher, CurseForge) or, when the user asks,
 * from Mojang's own download servers. It is never redistributed.
 */

export const MC_VERSIONS = ['1.20.1', '1.21.1', '1.21.4'] as const
export type McVersion = (typeof MC_VERSIONS)[number]

export function checkVersion(v: unknown): McVersion {
  if (!MC_VERSIONS.includes(v as McVersion)) throw new Error('unsupported version')
  return v as McVersion
}

function candidates(v: McVersion, cacheDir: string): { source: string; file: string }[] {
  const home = os.homedir()
  const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
  const prismRoots = [
    path.join(appData, 'PrismLauncher'),
    path.join(home, '.local', 'share', 'PrismLauncher'),
    path.join(home, 'Library', 'Application Support', 'PrismLauncher')
  ]
  const mcRoots = [path.join(appData, '.minecraft'), path.join(home, '.minecraft'), path.join(home, 'Library', 'Application Support', 'minecraft')]
  return [
    { source: 'cache', file: path.join(cacheDir, `${v}.jar`) },
    ...prismRoots.map((r) => ({ source: 'Prism Launcher', file: path.join(r, 'libraries', 'com', 'mojang', 'minecraft', v, `minecraft-${v}-client.jar`) })),
    ...mcRoots.map((r) => ({ source: 'Minecraft Launcher', file: path.join(r, 'versions', v, `${v}.jar`) })),
    { source: 'CurseForge', file: path.join(home, 'curseforge', 'minecraft', 'Install', 'versions', v, `${v}.jar`) }
  ]
}

const exists = (f: string) => fs.stat(f).then((s) => s.isFile(), () => false)

/** Where the client jar for a version can be read from, if anywhere. */
export async function findJar(v: McVersion, cacheDir: string): Promise<{ source: string; file: string } | null> {
  for (const c of candidates(v, cacheDir)) if (await exists(c.file)) return c
  return null
}

/** Download the client jar from Mojang (checked against its SHA-1) into the cache. */
export async function downloadJar(v: McVersion, cacheDir: string): Promise<string> {
  const manifest = (await (await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).json()) as {
    versions: { id: string; url: string }[]
  }
  const entry = manifest.versions.find((x) => x.id === v)
  if (!entry) throw new Error('version not found')
  const meta = (await (await fetch(entry.url)).json()) as { downloads: { client: { url: string; sha1: string } } }
  const { url, sha1 } = meta.downloads.client
  if (!/^https:\/\/[a-z0-9.-]+\.mojang\.com\//.test(url)) throw new Error('unexpected download host')
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
  if (createHash('sha1').update(buf).digest('hex') !== sha1) throw new Error('checksum mismatch')
  await fs.mkdir(cacheDir, { recursive: true })
  const file = path.join(cacheDir, `${v}.jar`)
  await fs.writeFile(file, buf)
  return file
}

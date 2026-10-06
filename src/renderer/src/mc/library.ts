import { useEffect, useState } from 'react'
import { storage } from '../lib/storage'
import { extractPack, type McPack, type McVersion } from './pack'
import { itemIcon } from './icons'

/*
 * Item packs per Minecraft version: read once from the client jar (found in a launcher on
 * this computer, or downloaded from Mojang on request) and cached in the app's global data.
 */

const key = (v: McVersion) => 'mcpack_' + v.replace(/\./g, '_')
const packs = new Map<McVersion, Promise<McPack | null>>()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((f) => f())

export type PackState = { status: 'loading' } | { status: 'ready'; pack: McPack } | { status: 'missing'; local: string | null } | { status: 'error'; message: string }

/** Cached pack, or one built from a launcher's jar on this computer. Null when neither exists. */
export function loadPack(v: McVersion): Promise<McPack | null> {
  let p = packs.get(v)
  if (!p) {
    p = (async () => {
      const cached = await storage.getGlobal<McPack>(key(v))
      if (cached?.format === 1) return cached
      const jar = await storage.mcRead(v)
      if (!jar) return null
      const pack = await extractPack(jar, v)
      await storage.setGlobal(key(v), pack)
      return pack
    })().catch(() => null)
    packs.set(v, p)
    p.then((r) => {
      if (!r) packs.delete(v) // try again later (e.g. after a download)
    })
  }
  return p
}

/** Download the client jar from Mojang, then build and cache the pack. */
export async function downloadPack(v: McVersion): Promise<McPack> {
  const jar = await storage.mcDownload(v)
  const pack = await extractPack(jar, v)
  await storage.setGlobal(key(v), pack)
  packs.set(v, Promise.resolve(pack))
  notify()
  return pack
}

export function usePack(v: McVersion): PackState {
  const [state, setState] = useState<PackState>({ status: 'loading' })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const f = () => setTick((t) => t + 1)
    listeners.add(f)
    return () => void listeners.delete(f)
  }, [])
  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    loadPack(v)
      .then(async (pack) => {
        if (!live) return
        if (pack) setState({ status: 'ready', pack })
        else setState({ status: 'missing', local: await storage.mcFind(v).catch(() => null) })
      })
      .catch((e) => live && setState({ status: 'error', message: String(e) }))
    return () => {
      live = false
    }
  }, [v, tick])
  return state
}

/** Icon data URL for an item id in a pack (null while rendering or if unknown). */
export function useItemIcon(pack: McPack | null, id: string | undefined, size = 64): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setUrl(null)
    if (pack && id) itemIcon(pack, id, size).then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [pack, id, size])
  return url
}

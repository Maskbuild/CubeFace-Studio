import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractPack, MC_VERSIONS } from '../src/renderer/src/mc/pack'

// Uses the Prism Launcher jars on this computer when present (nothing from Minecraft is in the repo)
const jar = (v: string) => `${process.env.APPDATA}/PrismLauncher/libraries/com/mojang/minecraft/${v}/minecraft-${v}-client.jar`

describe('minecraft item pack', () => {
  for (const v of MC_VERSIONS) {
    it.skipIf(!existsSync(jar(v)))(`reads items, models and textures from ${v}`, async () => {
      const pack = await extractPack(new Uint8Array(readFileSync(jar(v))), v)
      const byId = new Map(pack.items.map((i) => [i.id, i]))
      expect(pack.items.length).toBeGreaterThan(1000)
      expect(byId.get('diamond_sword')?.name).toBe('Diamond Sword')
      expect(pack.models[byId.get('stone')!.model]).toBeTruthy()
      expect(byId.has('compass_17')).toBe(false) // model variants are not items
      expect(pack.models['block/cube_all']).toBeTruthy()
      expect(pack.textures['item/diamond_sword']).toMatch(/^iVBOR/)
      expect(byId.get('oak_leaves')?.tints?.[0]).toBeTruthy()
      // keep the cached pack small
      expect(JSON.stringify(pack).length).toBeLessThan(4_000_000)
    }, 60_000)
  }
})

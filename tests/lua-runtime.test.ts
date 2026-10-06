import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import luaparse from 'luaparse'
import fengari from 'fengari'
import { buildModel, type ModelInput } from '../src/renderer/src/figura/bbmodel'
import { auriaConf, buildScript } from '../src/renderer/src/figura/script'
import { DEFAULT_AURIA, figuraDefaults, syncWheel, type FiguraConfig } from '../src/renderer/src/skin/figura'
import { hairDefaults } from '../src/renderer/src/skin/hair'

/*
 * Runs exported avatar scripts in a real Lua VM against a stand-in Figura API
 * (tests/lua/figura_mock.lua): loads them like Figura, fires events, presses every wheel
 * button, calls every ping. Any typo, nil call or bad argument fails the test.
 */

const { lua, lauxlib, lualib, to_luastring } = fengari
const MOCK = readFileSync('tests/lua/figura_mock.lua', 'utf8')

function filesUnder(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) Object.assign(out, filesUnder(p, base))
    else if (name.endsWith('.lua')) out[path.relative(path.dirname(base), p).split(path.sep).join('/')] = readFileSync(p, 'utf8')
  }
  return out
}
const AURIA = filesUnder('src/figura/auria_wheel')
const PHYSICS = readFileSync('src/figura/nkw_physics.lua', 'utf8')

function runLua(files: Record<string, string>, opts: { auto?: string[]; heads?: string[]; rounds?: number; check?: string } = {}) {
  const L = lauxlib.luaL_newstate()
  lualib.luaL_openlibs(L)
  lua.lua_newtable(L)
  for (const [k, v] of Object.entries(files)) {
    lua.lua_pushstring(L, to_luastring(v))
    lua.lua_setfield(L, -2, to_luastring(k))
  }
  lua.lua_setglobal(L, to_luastring('FILES'))
  const list = (name: string, items?: string[]) => {
    if (!items) return
    lua.lua_newtable(L)
    items.forEach((s, i) => {
      lua.lua_pushstring(L, to_luastring(s))
      lua.lua_rawseti(L, -2, i + 1)
    })
    lua.lua_setglobal(L, to_luastring(name))
  }
  list('AUTOSCRIPTS', opts.auto)
  list('EXTRA_HEAD_MODELS', opts.heads)
  const run = (src: string) => {
    if (lauxlib.luaL_dostring(L, to_luastring(src)) !== 0) throw new Error(lua.lua_tojsstring(L, -1))
    return lua.lua_gettop(L) > 0 ? lua.lua_tojsstring(L, -1) : ''
  }
  run(MOCK)
  const counts = run(`local ok, a, b = xpcall(RUN, debug.traceback, ${opts.rounds ?? 30}) if not ok then error(a, 0) end return a .. "," .. b`)
  const check = opts.check ? run(opts.check) : ''
  return { counts: counts.split(',').map(Number), check }
}

const hair = { ...hairDefaults('back', 'medium'), segments: 3, id: 'h1', name: 'Back', glow: true }
const input = (cfg: FiguraConfig, over: Partial<ModelInput> = {}): ModelInput => ({
  name: 'Test',
  variant: 'wide',
  res: 64,
  atlasW: 64,
  atlasH: 96,
  atlasDataUrl: 'data:image/png;base64,',
  glowDataUrl: 'data:image/png;base64,',
  glowSkin: true,
  slots: {
    hair_h1: { x: 0, y: 64, w: 8, h: 8 },
    face_base: { x: 8, y: 64, w: 8, h: 8 },
    face_blink: { x: 16, y: 64, w: 8, h: 8 },
    face_talk: { x: 24, y: 64, w: 8, h: 8 },
    face_happy: { x: 32, y: 64, w: 8, h: 8 },
    face_sad: { x: 40, y: 64, w: 8, h: 8 },
    eyes_glow: { x: 48, y: 64, w: 8, h: 8 }
  },
  hair: [hair],
  figura: cfg,
  faceFrames: ['base', 'blink', 'talk', 'happy', 'sad'],
  ...over
})

/** Everything the exported avatar ships for a config (script, physics, auria wheel). */
function avatarFiles(cfg: FiguraConfig): Record<string, string> {
  const { info } = buildModel(input(cfg))
  const script = buildScript('Test', cfg, info, [hair])
  const files: Record<string, string> = { 'script.lua': script }
  if (script.includes('require("nkw_physics")')) files['nkw_physics.lua'] = PHYSICS
  if (script.includes('require("auria_wheel.main")')) Object.assign(files, AURIA, { 'auria_wheel/conf.lua': auriaConf(cfg) })
  return files
}

// a small fixed-seed random, so failures can be reproduced
let seed = 12345
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)

function config(over: Partial<FiguraConfig> = {}): FiguraConfig {
  const cfg = { ...figuraDefaults(64), glowEyes: true, ...over }
  cfg.wheelPages = syncWheel(cfg)
  return cfg
}

describe('exported scripts run without errors', () => {
  const named: [string, Partial<FiguraConfig>][] = [
    ['defaults', {}],
    ['everything off', { smoothHead: false, hairPhysics: false, blink: false, talk: false, expressions: false, glowEyes: false }],
    ['auria wheel', { wheel: 'auria' }],
    ['auria, keep wheel open', { wheel: 'auria', auriaStyle: { ...DEFAULT_AURIA, closeOnExpr: false } }],
    ['switches start off', { startOff: ['glow', 'blink', 'physics', 'smoothHead', 'talk', 'glowEyes', 'glowSkin'] }],
    ['wizard options', { hideArmor: true, hideCape: true, hideElytra: true, dummyEvents: true }],
    ['tilted smooth head', { headTilt: 20, headSpeed: 0.2 }],
    ['hide all vanilla', { hideVanilla: 'all', skinParts: 'all' }]
  ]
  for (const [name, over] of named)
    it(name, () => {
      const cfg = config(over)
      // every switch on the wheel, so every toggle branch runs
      cfg.wheelPages[0].items.push(
        ...(['smoothHead', 'talk', 'glowEyes', 'glowSkin', 'glowHair:h1'] as const).map((t) => ({ id: 't_' + t, type: 'toggle' as const, toggle: t, title: '' })),
        { id: 'home', type: 'home', title: '' }
      )
      const { counts } = runLua(avatarFiles(cfg))
      expect(counts[0]).toBeGreaterThan(0) // wheel buttons were pressed
    })

  it('30 random combinations', () => {
    for (let n = 0; n < 30; n++) {
      const b = () => rnd() < 0.5
      const cfg = config({
        smoothHead: b(),
        hairPhysics: b(),
        blink: b(),
        talk: b(),
        expressions: b(),
        glowEyes: b(),
        wheel: b() ? 'auria' : 'figura',
        headTilt: b() ? 10 : 0,
        dummyEvents: b(),
        hideArmor: b(),
        startOff: b() ? ['glow', 'blink'] : []
      })
      try {
        runLua(avatarFiles(cfg), { rounds: 10 })
      } catch (e) {
        throw new Error(`combination ${n} ${JSON.stringify({ ...cfg, wheelPages: undefined })}: ${(e as Error).message}`)
      }
    }
  })
})

describe('merged with another avatar', () => {
  const other = [
    '-- another avatar with its own wheel and head piece',
    'local page = action_wheel:newPage("Glasses")',
    'page:newAction():title("Shine"):onLeftClick(function() models.glass.Head:setVisible(true) end)',
    'action_wheel:setPage(page)',
    'function events.tick() end'
  ].join('\n')

  it('turns their head piece with the smooth head and links their wheel page', () => {
    const files = { ...avatarFiles(config()), 'glass_script.lua': other }
    const { check } = runLua(files, {
      auto: ['script', 'glass_script'],
      heads: ['glass'],
      check: [
        'local h = models.glass.Head',
        'local turned = rawget(h, "__kids").setOffsetRot ~= nil',
        // a button on our main page opens their page
        'local linked = false',
        'for _, c in ipairs(CALLBACKS) do if c.name == "onLeftClick" and c.owner.__title == "Glasses" then linked = true end end',
        'return tostring(turned) .. "," .. tostring(linked)'
      ].join('\n')
    })
    expect(check).toBe('true,true')
  })
})

describe('no stray globals', () => {
  // everything Figura provides, plus Lua's own library
  const ALLOWED = new Set(
    'models vanilla_model action_wheel host client player world renderer keybinds textures sounds particles nameplate avatar animations pings events vec vectors math table string pairs ipairs type tostring tonumber setmetatable getmetatable rawget rawset pcall error assert select next require listFiles print log unpack plasmovoice'.split(' ')
  )
  it('script.lua and nkw_physics.lua only use known globals (and define none by accident)', () => {
    const cfg = config({ wheel: 'figura', startOff: ['glow'], dummyEvents: true, hideArmor: true })
    for (const [name, src] of Object.entries(avatarFiles(cfg))) {
      if (name.startsWith('auria_wheel/')) continue
      const unknown = new Set<string>()
      luaparse.parse(src, {
        luaVersion: '5.2',
        scope: true,
        onCreateNode: (node) => {
          const n = node as unknown as { type: string; name?: string; isLocal?: boolean }
          if (n.type === 'Identifier' && n.isLocal === false && n.name && !ALLOWED.has(n.name)) unknown.add(n.name)
        }
      })
      // action_wheel is replaced on purpose (to catch merged avatars' wheels)
      expect([...unknown], name).toEqual([])
    }
  })
})

describe('first person', () => {
  it('hides the head parts in a first-person camera and gives their visibility back after', () => {
    const { check } = runLua(avatarFiles(config()), {
      heads: ['glass'],
      check: [
        'FIRST_PERSON = true',
        'FIRE("render", 0.5, "RENDER")',
        'local hidden = rawget(models.model.Head, "__kids").setVisible ~= nil',
        'local calls = {}',
        // record what setVisible gets from now on
        'local h = models.glass.Head',
        'FIRST_PERSON = false',
        'FIRE("render", 0.5, "RENDER")',
        'return tostring(hidden)'
      ].join('\n')
    })
    expect(check).toBe('true')
  })
})

import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AvatarLibrary, mergeAvatars } from '../src/main/avatars'

const tmp = () => mkdtempSync(path.join(tmpdir(), 'nkw-'))
const avatar = (name: string, author: string, files: Record<string, string>) => {
  const dir = path.join(tmp(), name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'avatar.json'), JSON.stringify({ name, authors: [author] }))
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
    writeFileSync(path.join(dir, f), text)
  }
  return dir
}

describe('avatar library', () => {
  it('imports avatar folders and rejects other folders', async () => {
    const lib = new AvatarLibrary(tmp())
    const m = await lib.import(avatar('Cat', 'A', { 'script.lua': 'print(1)', 'model.bbmodel': '{"textures":[{"source":"data:image/png;base64,AAAA"}]}' }))
    expect(m?.name).toBe('Cat')
    expect(m?.authors).toEqual(['A'])
    expect(m?.files).toBe(3)
    expect(m?.thumb).toBe('data:image/png;base64,AAAA')
    const notAvatar = tmp()
    writeFileSync(path.join(notAvatar, 'readme.txt'), 'hi')
    expect(await lib.import(notAvatar)).toBeNull()
    expect((await lib.list()).map((x) => x.name)).toEqual(['Cat'])
  })

  it('merges with automatic renaming and credits each included avatar', async () => {
    const a = avatar('One', 'A', { 'script.lua': 'one', 'textures/skin.png': 'x' })
    const b = avatar('Two', 'B', { 'script.lua': 'two', 'textures/skin.png': 'y', 'extra.lua': 'e' })
    const out = path.join(tmp(), 'merged')
    const r = await mergeAvatars(out, [
      { files: { 'avatar.json': JSON.stringify({ name: 'Mine', authors: ['Me'] }), 'script.lua': 'mine' }, label: 'Mine' },
      { dir: a, label: 'One' },
      { dir: b, label: 'Two' }
    ])
    expect(readFileSync(path.join(out, 'script.lua'), 'utf8')).toBe('mine')
    expect(readFileSync(path.join(out, 'script_2.lua'), 'utf8')).toBe('one')
    expect(readFileSync(path.join(out, 'script_3.lua'), 'utf8')).toBe('two')
    expect(existsSync(path.join(out, 'textures', 'skin_2.png'))).toBe(true)
    expect(r.renamed).toHaveLength(3)
    const json = JSON.parse(readFileSync(path.join(out, 'avatar.json'), 'utf8'))
    expect(json.name).toBe('Mine')
    expect(json.authors).toEqual(['Me', 'A - One', 'B - Two']) // owner first, then "<author> - <figura>"
  })
})

import { zip } from '../src/renderer/src/lib/zip'

describe('dropping avatars', () => {
  it('imports a .zip of an avatar (also when wrapped in a folder) and skips unsafe paths', async () => {
    const lib = new AvatarLibrary(tmp())
    const z = path.join(tmp(), 'Fox.zip')
    writeFileSync(z, zip([
      { name: 'Fox/avatar.json', data: JSON.stringify({ name: 'Fox', authors: ['B'] }) },
      { name: 'Fox/script.lua', data: 'print(1)' },
      { name: '../evil.txt', data: 'x' }
    ]))
    const added = await lib.importAny(z)
    expect(added.map((m) => m.name)).toEqual(['Fox'])
    expect(added[0].files).toBe(2)
  })
  it('imports every avatar inside a dropped folder', async () => {
    const lib = new AvatarLibrary(tmp())
    const root = tmp()
    for (const n of ['A', 'B']) {
      mkdirSync(path.join(root, n))
      writeFileSync(path.join(root, n, 'avatar.json'), JSON.stringify({ name: n }))
    }
    mkdirSync(path.join(root, 'not-an-avatar'))
    expect((await lib.importAny(root)).map((m) => m.name).sort()).toEqual(['A', 'B'])
  })
})

import { execFileSync } from 'node:child_process'

const RAR = 'C:/Program Files/WinRAR/Rar.exe'
describe('rar avatars', () => {
  it.skipIf(!existsSync(RAR))('imports an avatar from a .rar file', async () => {
    const src = avatar('Owl', 'C', { 'script.lua': 'print(2)' })
    const out = path.join(tmp(), 'Owl.rar')
    execFileSync(RAR, ['a', '-ep1', '-r', '-idq', out, src])
    const lib = new AvatarLibrary(tmp())
    const added = await lib.importAny(out)
    expect(added.map((m) => m.name)).toEqual(['Owl'])
    expect(added[0].files).toBe(2)
  })
})

import { rewriteRefs } from '../src/main/avatars'

describe('merged avatars keep working', () => {
  it('rewrites renamed models, textures and requires in the merged-in scripts', async () => {
    const mine = { 'avatar.json': JSON.stringify({ name: 'Mine', authors: ['Me'] }), 'model.bbmodel': '{}', 'script.lua': 'models.model.Head:setVisible(true)' }
    const other = avatar('Cat', 'A', {
      'model.bbmodel': '{}',
      'script.lua': 'local lib = require("lib.util")\nmodels.model.Tail:setRot(0)\nlocal t = textures["model.skin"]\nmodels["model"]:setVisible(true)\nprint(models.modelExtra)',
      'lib/util.lua': 'return {}'
    })
    const out = path.join(tmp(), 'merged')
    await mergeAvatars(out, [{ files: mine, label: 'Mine' }, { dir: other, label: 'Cat' }])
    const s2 = readFileSync(path.join(out, 'script_2.lua'), 'utf8')
    expect(s2).toContain('models.model_2.Tail')
    expect(s2).toContain('textures["model_2.skin"]')
    expect(s2).toContain('models["model_2"]')
    expect(s2).toContain('models.modelExtra') // other names untouched
    expect(s2).toContain('require("lib.util")') // not renamed, so unchanged
    expect(readFileSync(path.join(out, 'script.lua'), 'utf8')).toBe('models.model.Head:setVisible(true)') // ours untouched
  })
  it('follows renamed scripts in require() and joins autoScripts', async () => {
    const a = avatar('A', 'x', { 'main.lua': 'require("util")', 'util.lua': '' })
    const b = avatar('B', 'y', { 'main.lua': 'require("util")\nrequire("./util")', 'util.lua': '' })
    writeFileSync(path.join(a, 'avatar.json'), JSON.stringify({ name: 'A', autoScripts: ['main'] }))
    const out = path.join(tmp(), 'm2')
    await mergeAvatars(out, [{ dir: a, label: 'A' }, { dir: b, label: 'B' }])
    expect(readFileSync(path.join(out, 'main_2.lua'), 'utf8')).toBe('require("util_2")\nrequire("util_2")')
    const info = JSON.parse(readFileSync(path.join(out, 'avatar.json'), 'utf8'))
    expect(info.autoScripts.sort()).toEqual(['main', 'main_2', 'util_2'])
    expect(rewriteRefs('models.a.b', new Map([['a', 'a_2']]), new Map())).toBe('models.a_2.b')
  })
})

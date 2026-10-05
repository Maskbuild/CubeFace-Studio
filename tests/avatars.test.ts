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

  it('merges with automatic renaming and combined authors', async () => {
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
    expect(json.authors).toEqual(['Me', 'A', 'B'])
  })
})

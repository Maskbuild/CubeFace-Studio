import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { crc32, zip } from '../src/renderer/src/lib/zip'

describe('zip writer', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('produces an archive that tar can extract', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nkwzip-'))
    const file = path.join(dir, 'a.zip')
    writeFileSync(file, zip([{ name: 'manifest.json', data: '{"a":1}' }, { name: 'textures/x.txt', data: 'hello ไทย' }]))
    // Windows ships bsdtar (reads zip); Git Bash's GNU tar does not
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe') : 'bsdtar'
    execFileSync(tar, ['-xf', file, '-C', dir])
    expect(readFileSync(path.join(dir, 'manifest.json'), 'utf8')).toBe('{"a":1}')
    expect(readFileSync(path.join(dir, 'textures', 'x.txt'), 'utf8')).toBe('hello ไทย')
  })
})

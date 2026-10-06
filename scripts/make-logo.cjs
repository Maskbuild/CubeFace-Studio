// Draws the CubeFace Studio logo as 32×32 pixel art and writes the app icon files:
//   build/icon.png (512), build/icon.ico (16–256), src/renderer/src/assets/logo.png (128),
//   docs/images/logo.png (256). Run: node scripts/make-logo.cjs
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const N = 32
const px = new Uint8Array(N * N * 4)
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255]
const set = (x, y, c) => {
  if (x < 0 || y < 0 || x >= N || y >= N) return
  px.set(typeof c === 'string' ? hex(c) : c, (y * N + x) * 4)
}
const rect = (x0, y0, w, h, c) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, c)
}

// background: rounded dark square with a teal rim
const R = 6
const inside = (x, y, r, m) => {
  const cx = Math.min(Math.max(x, m + r), N - 1 - m - r)
  const cy = Math.min(Math.max(y, m + r), N - 1 - m - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.5
}
for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++) {
    if (!inside(x, y, R, 0)) continue
    set(x, y, inside(x, y, R - 1, 1) ? (y < 16 ? '#18212b' : '#141b24') : '#2fb8c4')
  }

// head (Minecraft face, 8×8 at 2×) with a soft shadow
rect(8, 10, 16, 16, '#0d1218')
rect(7, 9, 16, 16, '#f0c8a0')
rect(7, 9, 16, 4, '#3fd6e3') // hair
rect(7, 13, 2, 4, '#3fd6e3')
rect(21, 13, 2, 4, '#3fd6e3')
rect(7, 9, 16, 1, '#7ae9f2') // hair highlight
rect(9, 12, 2, 1, '#239aa6')
rect(15, 12, 3, 1, '#239aa6')
rect(7, 23, 16, 2, '#d9a97c') // chin shade
// eyes: white + glowing cyan pupils (Figura glow)
rect(9, 17, 4, 2, '#ffffff')
rect(17, 17, 4, 2, '#ffffff')
rect(11, 17, 2, 2, '#22e3f2')
rect(17, 17, 2, 2, '#22e3f2')
set(10, 16, '#bff7fb')
set(19, 16, '#bff7fb')
rect(13, 21, 4, 1, '#b8664c') // mouth

// paintbrush across the bottom-right corner
const brush = [
  [28, 18], [27, 19], [26, 20], [25, 21], [24, 22]
]
for (const [x, y] of brush) {
  set(x, y, '#f5c542')
  set(x - 1, y, '#d9a21f')
}
set(23, 23, '#c3cad3')
set(22, 23, '#8f98a3')
set(23, 24, '#8f98a3')
set(22, 24, '#3fd6e3')
set(21, 25, '#3fd6e3')
set(22, 25, '#239aa6')
set(20, 26, '#239aa6')

// sparkle top right
set(26, 5, '#ffffff')
rect(25, 6, 3, 1, '#ffffff')
set(26, 7, '#ffffff')
set(26, 4, '#7ae9f2')
set(26, 8, '#7ae9f2')
set(24, 6, '#7ae9f2')
set(28, 6, '#7ae9f2')

// ---- PNG / ICO writers ----------------------------------------------------------------------
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
function png(size) {
  const k = size / N
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const s = (Math.floor(y / k) * N + Math.floor(x / k)) * 4
      px.copy ? null : null
      for (let i = 0; i < 4; i++) raw[y * (size * 4 + 1) + 1 + x * 4 + i] = px[s + i]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
function ico(sizes) {
  const imgs = sizes.map(png)
  const head = Buffer.alloc(6 + 16 * sizes.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(sizes.length, 4)
  let off = head.length
  sizes.forEach((s, i) => {
    const e = 6 + i * 16
    head[e] = s >= 256 ? 0 : s
    head[e + 1] = s >= 256 ? 0 : s
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(imgs[i].length, e + 8)
    head.writeUInt32LE(off, e + 12)
    off += imgs[i].length
  })
  return Buffer.concat([head, ...imgs])
}

const root = path.join(__dirname, '..')
const out = (p, data) => {
  fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true })
  fs.writeFileSync(path.join(root, p), data)
}
out('build/icon.png', png(512))
out('build/icon.ico', ico([16, 32, 48, 64, 128, 256]))
out('src/renderer/src/assets/logo.png', png(128))
out('docs/images/logo.png', png(256))
console.log('logo written')

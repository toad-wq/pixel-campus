// 极简 PNG 编码器：把 uint32 帧缓冲写成 RGBA PNG。
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(b) {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

export function writePng(path, buf, W, H) {
  const raw = Buffer.alloc((W * 4 + 1) * H)
  let o = 0
  for (let y = 0; y < H; y++) {
    raw[o++] = 0
    for (let x = 0; x < W; x++) {
      const v = buf[y * W + x]
      raw[o++] = v & 255
      raw[o++] = (v >> 8) & 255
      raw[o++] = (v >> 16) & 255
      raw[o++] = (v >>> 24) & 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  writeFileSync(
    path,
    Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]),
  )
}

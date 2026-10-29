// 把整张地图渲染成 docs/preview.png，并校验分块拼装是否逐像素一致。
import { paintGround, WORLD_W, WORLD_H } from '../源码/地面渲染.js'
import { writePng } from './图片编码.mjs'

const CHUNK = 256
const NX = Math.ceil(WORLD_W / CHUNK)
const NY = Math.ceil(WORLD_H / CHUNK)

// 1. 整图基准
const full = new Uint32Array(WORLD_W * WORLD_H)
paintGround({ buf: full, width: WORLD_W, height: WORLD_H, originX: 0, originY: 0 })

// 2. 分块拼装
const composed = new Uint32Array(WORLD_W * WORLD_H)
for (let cy = 0; cy < NY; cy++) {
  for (let cx = 0; cx < NX; cx++) {
    const cw = Math.min(CHUNK, WORLD_W - cx * CHUNK)
    const ch = Math.min(CHUNK, WORLD_H - cy * CHUNK)
    const buf = new Uint32Array(cw * ch)
    paintGround({ buf, width: cw, height: ch, originX: cx * CHUNK, originY: cy * CHUNK })
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        composed[(cy * CHUNK + y) * WORLD_W + (cx * CHUNK + x)] = buf[y * cw + x]
      }
    }
  }
}

let diff = 0
for (let i = 0; i < full.length; i++) if (full[i] !== composed[i]) diff++
console.log(
  diff === 0
    ? `MATCH: ${NX * NY} 块拼装与整图逐像素完全一致`
    : `MISMATCH: ${diff} 个像素不同`,
)

writePng(new URL('../说明/预览图.png', import.meta.url), composed, WORLD_W, WORLD_H)
console.log('wrote 说明/预览图.png')

// 分块管理器：把 1024×624 世界切成 4×3 = 12 块 256×256（边缘块更小）。
// 每块只光栅化一次，结果缓存成独立的 canvas（相当于一张纹理）；
// 运行时只需要把 12 张纹理 drawImage 拼到一起。

import { paintGround, WORLD_W, WORLD_H } from './ground.js'
import { createFramebuffer, present } from './pixel.js'

export const CHUNK = 256
export const CHUNKS_X = Math.ceil(WORLD_W / CHUNK) // 4
export const CHUNKS_Y = Math.ceil(WORLD_H / CHUNK) // 3

const cache = new Map()

// 烘焙一块：画一次 → 存成 canvas → 返回（带耗时）
export function bakeChunk(cx, cy) {
  const key = cx + ',' + cy
  if (cache.has(key)) return cache.get(key)

  // 边缘块比 256 小
  const cw = Math.min(CHUNK, WORLD_W - cx * CHUNK)
  const chh = Math.min(CHUNK, WORLD_H - cy * CHUNK)

  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = chh

  // 关键：给帧缓冲一个「世界原点」，paintGround 只会画这一块。
  const fb = createFramebuffer(canvas, cx * CHUNK, cy * CHUNK)

  const t0 = performance.now()
  paintGround(fb)
  present(fb)
  const ms = performance.now() - t0

  const chunk = { cx, cy, canvas, ms, w: cw, h: chh }
  cache.set(key, chunk)
  return chunk
}

export function clearCache() {
  cache.clear()
}

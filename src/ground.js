// 地面：来自「延边大学（延吉校区）建筑分布图」的类别网格，星露谷像素风重绘。
// 0=草地 1=铺装/道路 2=绿地 3=米黄楼(教学) 4=蓝楼(宿舍)

import { pack, setPixel } from './pixel.js'
import { MAP_W, MAP_H, CATS } from './mapdata.js'

export const CELL = 4
export const WORLD_W = MAP_W * CELL
export const WORLD_H = MAP_H * CELL
export const TILE = 16
export const GRID_W = Math.ceil(WORLD_W / TILE)
export const GRID_H = Math.ceil(WORLD_H / TILE)

export const CAT = {
  GRASS: 0,
  PAVE: 1,
  LAWN: 2,
  TAN: 3,
  BLUE: 4,
}

export const GRID = Uint8Array.from(atob(CATS), (c) => c.charCodeAt(0))

function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// 草地
const GRASS = ['#3a7a28', '#4a8f34', '#5aa23e', '#70b64a', '#8aca5c'].map((h) => pack(h))
const GRASS_DARK = pack('#2f5f22')
const FLOWERS = ['#f2d94e', '#e87ea0', '#f4f0d8'].map((h) => pack(h))

// 铺装 / 道路
const PAVE = pack('#e9e3d2')
const PAVE_D = pack('#ded7c4')
const PAVE_LINE = pack('#cec6b2')
const PAVE_EDGE = pack('#a89c82')

// 绿地
const TURF = ['#2c5f2a', '#3f8437', '#4c9a42', '#66b558'].map((h) => pack(h))

// 建筑
const OUTLINE = pack('#2e2318')
const RIDGE = pack('#f0e0c0')
const SHADOW = pack('#2a5a22')
const ROOFS = {
  3: { base: ['#c0603a', '#b0522f', '#d07048'].map((h) => pack(h)), dark: ['#7a3a1e', '#6e341a', '#8a4426'].map((h) => pack(h)) },
  4: { base: ['#4a6fa5', '#3f6fa8', '#587fb5'].map((h) => pack(h)), dark: ['#2e4a70', '#274468', '#365a82'].map((h) => pack(h)) },
}

function isBuilding(cat) {
  return cat === CAT.TAN || cat === CAT.BLUE
}

function grassColor(px, py) {
  const r = hash2(px, py)
  if (r < 0.06) return GRASS[0]
  if (r < 0.32) return GRASS[1]
  if (r < 0.78) return GRASS[2]
  if (r < 0.96) return GRASS[3]
  return GRASS[4]
}

function turfColor(px, py) {
  const band = Math.floor(py / 12) % 2
  const r = hash2(px, py)
  if (r < 0.1) return TURF[0]
  return r < 0.9 ? (band ? TURF[1] : TURF[2]) : TURF[3]
}

function paveColor(px, py) {
  if (px % 8 === 0 || py % 8 === 0) return PAVE_LINE
  const r = hash2(px, py)
  if (r < 0.18) return PAVE_D
  return PAVE
}

// 草地：噪点 + 草丛 + 小花 + 偶发灌木
const BUSH = ['#2e6b2a', '#3f8a36', '#4f9e42'].map((c) => pack(c))
function paintGrassCell(fb, cx, cy) {
  const x0 = cx * CELL
  const y0 = cy * CELL
  for (let y = 0; y < CELL; y++) {
    const py = y0 + y
    for (let x = 0; x < CELL; x++) setPixel(fb, x0 + x, py, grassColor(x0 + x, py))
  }
  const h = hash2(cx * 31 + 7, cy * 17 + 3)
  const tx = x0 + (Math.floor(h * 997) % 3)
  const ty = y0 + (Math.floor(h * 691) % 3)
  if (h < 0.012) {
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const corner = (x === 0 || x === CELL - 1) && (y === 0 || y === CELL - 1)
        if (corner) continue
        const edge = x === 0 || y === 0 || x === CELL - 1 || y === CELL - 1
        setPixel(fb, x0 + x, y0 + y, edge ? BUSH[0] : x + y === CELL ? BUSH[2] : BUSH[1])
      }
    }
  } else if (h < 0.2) {
    setPixel(fb, tx, ty, GRASS_DARK)
    setPixel(fb, tx + 1, ty, GRASS_DARK)
  } else if (h > 0.94) {
    // 小花丛（1~3 朵）
    const n = 1 + (Math.floor(h * 97) % 3)
    for (let i = 0; i < n; i++) {
      const fx = x0 + (Math.floor(h * 731 + i * 37) % 4)
      const fy = y0 + (Math.floor(h * 173 + i * 53) % 4)
      setPixel(fb, fx, fy, FLOWERS[(Math.floor(h * 31) + i) % FLOWERS.length])
    }
  }
}

// 铺装：石板 + 边界路缘
function paintPaveCell(fb, cx, cy) {
  const x0 = cx * CELL
  const y0 = cy * CELL
  for (let y = 0; y < CELL; y++) {
    const py = y0 + y
    for (let x = 0; x < CELL; x++) setPixel(fb, x0 + x, py, paveColor(x0 + x, py))
  }
  // 碎石点缀
  const hp = hash2(cx * 13 + 5, cy * 29 + 11)
  if (hp < 0.35) {
    setPixel(fb, x0 + (Math.floor(hp * 997) % 4), y0 + (Math.floor(hp * 691) % 4), PAVE_EDGE)
  }
  const i = cy * MAP_W + cx
  const catL = cx > 0 ? GRID[i - 1] : 255
  const catR = cx < MAP_W - 1 ? GRID[i + 1] : 255
  const catU = cy > 0 ? GRID[i - MAP_W] : 255
  const catD = cy < MAP_H - 1 ? GRID[i + MAP_W] : 255
  if (catL !== CAT.PAVE) for (let y = 0; y < CELL; y++) setPixel(fb, x0, y0 + y, PAVE_EDGE)
  if (catR !== CAT.PAVE) for (let y = 0; y < CELL; y++) setPixel(fb, x0 + CELL - 1, y0 + y, PAVE_EDGE)
  if (catU !== CAT.PAVE) for (let x = 0; x < CELL; x++) setPixel(fb, x0 + x, y0, PAVE_EDGE)
  if (catD !== CAT.PAVE) for (let x = 0; x < CELL; x++) setPixel(fb, x0 + x, y0 + CELL - 1, PAVE_EDGE)
}

// 建筑：屋顶 + 高光 + 阴影 + 描边
function paintBuildingCell(fb, cx, cy, cat) {
  const i = cy * MAP_W + cx
  const catL = cx > 0 ? GRID[i - 1] : 255
  const catR = cx < MAP_W - 1 ? GRID[i + 1] : 255
  const catU = cy > 0 ? GRID[i - MAP_W] : 255
  const catD = cy < MAP_H - 1 ? GRID[i + MAP_W] : 255

  const x0 = cx * CELL
  const y0 = cy * CELL
  const roof = ROOFS[cat] || ROOFS[3]
  const idx = Math.floor(hash2(cx, cy) * roof.base.length) % roof.base.length
  const base = roof.base[idx]
  const dark = roof.dark[idx]

  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) setPixel(fb, x0 + x, y0 + y, base)
  }
  // 瓦楞横线（增强屋顶质感）
  for (let x = 0; x < CELL; x++) setPixel(fb, x0 + x, y0 + 2, dark)
  if (!isBuilding(catU)) {
    for (let x = 0; x < CELL; x++) setPixel(fb, x0 + x, y0, RIDGE)
  }
  if (!isBuilding(catD)) {
    for (let x = 0; x < CELL; x++) {
      setPixel(fb, x0 + x, y0 + CELL - 1, OUTLINE)
      setPixel(fb, x0 + x, y0 + CELL - 2, dark)
    }
  }
  if (!isBuilding(catL)) {
    for (let y = 0; y < CELL; y++) setPixel(fb, x0, y0 + y, OUTLINE)
  }
  if (!isBuilding(catR)) {
    for (let y = 0; y < CELL; y++) setPixel(fb, x0 + CELL - 1, y0 + y, OUTLINE)
  }
}

// 树
const TRUNK = pack('#5a3a1e')
const TRUNK_D = pack('#3e2712')
const LEAF = ['#2e6b2a', '#3f8a36', '#4f9e42', '#5fb04e'].map((c) => pack(c))
function paintTree(fb, cx, cy) {
  const mx = cx * CELL + 2
  const my = cy * CELL + 2
  for (let dy = 0; dy <= 4; dy++) {
    for (let dx = -7; dx <= 7; dx++) {
      if ((dx * dx) / 49 + (dy * dy) / 9 <= 1) setPixel(fb, mx + dx, my + 8 + dy, SHADOW)
    }
  }
  for (let y = 0; y <= 6; y++) {
    setPixel(fb, mx - 1, my + y, TRUNK)
    setPixel(fb, mx, my + y, TRUNK_D)
  }
  const cyC = -4
  for (let dy = -12; dy <= 2; dy++) {
    for (let dx = -7; dx <= 7; dx++) {
      const d = Math.sqrt(dx * dx + (dy - cyC) * (dy - cyC))
      if (d <= 6.8) {
        let c
        const lx = dx + 2
        const ly = dy - cyC + 2
        if (lx * lx + ly * ly < 12) c = LEAF[3]
        else if (d < 3) c = LEAF[2]
        else if (d < 5) c = LEAF[1]
        else c = LEAF[0]
        setPixel(fb, mx + dx, my + dy, c)
      }
    }
  }
  for (let dy = -12; dy <= 2; dy++) {
    for (let dx = -7; dx <= 7; dx++) {
      const d = Math.sqrt(dx * dx + (dy - cyC) * (dy - cyC))
      if (d > 6.8 && d <= 7.6) setPixel(fb, mx + dx, my + dy, OUTLINE)
    }
  }
}

// 主入口
export function paintGround(fb) {
  const ox = fb.originX ?? 0
  const oy = fb.originY ?? 0
  const x1 = ox + fb.width
  const y1 = oy + fb.height
  const MARGIN = 4

  const cx0 = Math.max(0, Math.floor((ox - MARGIN * CELL) / CELL))
  const cy0 = Math.max(0, Math.floor((oy - MARGIN * CELL) / CELL))
  const cx1 = Math.min(MAP_W - 1, Math.floor((x1 + MARGIN * CELL) / CELL))
  const cy1 = Math.min(MAP_H - 1, Math.floor((y1 + MARGIN * CELL) / CELL))

  // ① 非建筑
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const cat = GRID[cy * MAP_W + cx]
      if (cat === CAT.GRASS) paintGrassCell(fb, cx, cy)
      else if (cat === CAT.PAVE) paintPaveCell(fb, cx, cy)
      else if (cat === CAT.LAWN) {
        const x0 = cx * CELL
        const y0 = cy * CELL
        for (let y = 0; y < CELL; y++) {
          const py = y0 + y
          for (let x = 0; x < CELL; x++) setPixel(fb, x0 + x, py, turfColor(x0 + x, py))
        }
      }
    }
  }

  // ② 树（只在 5×5 全草地的开阔处）
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      if (GRID[cy * MAP_W + cx] !== CAT.GRASS) continue
      if (cx < 2 || cy < 2 || cx >= MAP_W - 2 || cy >= MAP_H - 2) continue
      let ok = true
      for (let dy = -2; dy <= 2 && ok; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (GRID[(cy + dy) * MAP_W + (cx + dx)] !== CAT.GRASS) {
            ok = false
            break
          }
        }
      }
      if (!ok) continue
      if (hash2(cx * 3 + 1, cy * 5 + 2) < 0.003) paintTree(fb, cx, cy)
    }
  }

  // ③ 建筑
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const cat = GRID[cy * MAP_W + cx]
      if (cat === CAT.TAN || cat === CAT.BLUE) paintBuildingCell(fb, cx, cy, cat)
    }
  }

  // ④ 建筑南侧投影（落在草地/绿地/铺装上）
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const i = cy * MAP_W + cx
      if (!isBuilding(GRID[i])) continue
      if (cy >= MAP_H - 1) continue
      const catD = GRID[i + MAP_W]
      if (catD === CAT.GRASS || catD === CAT.LAWN || catD === CAT.PAVE) {
        const x0 = cx * CELL
        const y0 = cy * CELL
        for (let x = 0; x < CELL; x++) {
          setPixel(fb, x0 + x, y0 + CELL, SHADOW)
          setPixel(fb, x0 + x, y0 + CELL + 1, SHADOW)
        }
      }
    }
  }
}

export function buildTileMap() {
  const map = new Uint8Array(GRID_W * GRID_H)
  for (let ty = 0; ty < GRID_H; ty++) {
    for (let tx = 0; tx < GRID_W; tx++) {
      const cx = Math.min(MAP_W - 1, Math.floor((tx * TILE + TILE / 2) / CELL))
      const cy = Math.min(MAP_H - 1, Math.floor((ty * TILE + TILE / 2) / CELL))
      map[ty * GRID_W + tx] = GRID[cy * MAP_W + cx]
    }
  }
  return map
}

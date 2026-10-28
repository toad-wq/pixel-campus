// 建筑信息层：把「一栋楼」从像素里认出来，点了之后能显示它的编号与尺寸。
//
// 这一步只解决「认得出 + 说得清」，楼名和简介留白 —— 那是内容同学的活。
// 数据来自 src/buildings.json（由 tools/extract-buildings.mjs 生成）。
import { CAT, CELL, GRID } from './ground.js'
import { MAP_H, MAP_W } from './mapdata.js'
import buildings from './buildings.json'

const byBbox = new Map()
for (const b of buildings) byBbox.set(b.cell.join(','), b)

export const BUILDINGS = buildings
export const BUILDING_COUNT = buildings.length

function isBuildingCell(cat) {
  return cat === CAT.TAN || cat === CAT.BLUE
}

// 点到一个格子后，把与它相连的整栋楼 flood fill 出来。
// 返回 { building, cells } —— building 为 null 表示这是没进清单的碎片。
export function pickBuilding(cellX, cellY) {
  if (cellX < 0 || cellY < 0 || cellX >= MAP_W || cellY >= MAP_H) return null
  const start = cellY * MAP_W + cellX
  if (!isBuildingCell(GRID[start])) return null

  const seen = new Set([start])
  const stack = [start]
  const cells = []
  let minX = cellX
  let maxX = cellX
  let minY = cellY
  let maxY = cellY

  while (stack.length) {
    const i = stack.pop()
    const ix = i % MAP_W
    const iy = (i - ix) / MAP_W
    cells.push(i)
    if (ix < minX) minX = ix
    if (ix > maxX) maxX = ix
    if (iy < minY) minY = iy
    if (iy > maxY) maxY = iy
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = ix + dx
      const ny = iy + dy
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue
      const n = ny * MAP_W + nx
      if (seen.has(n) || !isBuildingCell(GRID[n])) continue
      seen.add(n)
      stack.push(n)
    }
  }

  const bbox = [minX, minY, maxX - minX + 1, maxY - minY + 1]
  return { building: byBbox.get(bbox.join(',')) ?? null, cells, bbox }
}

// 叠加层：先清空，再把建筑涂上去（世界坐标，直接画 4×4 的格子色块）
export function clearCells(canvas) {
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
}

export function paintCells(canvas, cells, fill, outline) {
  const ctx = canvas.getContext('2d')
  if (!cells || !cells.length) return

  ctx.fillStyle = fill
  for (const i of cells) {
    const x = (i % MAP_W) * CELL
    const y = ((i - (i % MAP_W)) / MAP_W) * CELL
    ctx.fillRect(x, y, CELL, CELL)
  }

  if (!outline) return
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const i of cells) {
    const x = i % MAP_W
    const y = (i - x) / MAP_W
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  ctx.strokeStyle = outline
  ctx.lineWidth = 1
  ctx.strokeRect(minX * CELL + 0.5, minY * CELL + 0.5, (maxX - minX + 1) * CELL - 1, (maxY - minY + 1) * CELL - 1)
}

// 面板文字：一栋楼的全部已知信息 + 还没填的部分
export function describe(building, bbox, cells) {
  if (!building) {
    return {
      title: '未登记的小结构',
      lines: [
        `格 ${bbox[2]} × ${bbox[3]} · ${cells.length} 个格子`,
        '面积太小（< 8 格），没进建筑清单，多半是围墙或误判的零星像素。',
      ],
    }
  }
  const kind = building.cat === 'dorm' ? '宿舍楼' : '教学楼'
  const lines = [
    `格 ${building.cell[2]} × ${building.cell[3]} · ${building.cells} 个格子 · 填充率 ${Math.round(building.fill * 100)}%`,
    `世界坐标 ${building.world[0]}, ${building.world[1]} · 尺寸 ${building.world[2]} × ${building.world[3]} px`,
  ]
  lines.push(
    building.name ? `名称：${building.name}` : '名称：待补',
    building.intro ? `简介：${building.intro}` : '简介：待补',
  )
  return { title: `${building.id} · ${kind}`, lines }
}

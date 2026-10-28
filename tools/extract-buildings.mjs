// 从类别网格里提取「一栋楼」级别的数据：连通域 → 建筑清单 src/buildings.json
//
// 用法：node tools/extract-buildings.mjs
//
// 这一步是把「像素」变成「内容」的桥：地图上每栋楼从此有了稳定 id、格坐标和尺寸，
// 再填上名字和一句话简介，就能在页面里点开看（见 src/inspect.js）。
// 输出是确定性的：同样的 mapdata 一定得到同样的 JSON，可以放心进版本库。
import { writeFileSync } from 'node:fs'
import { CELL, GRID, CAT } from '../src/ground.js'
import { MAP_H, MAP_W } from '../src/mapdata.js'

// 少于这个格数的连通域当碎片（零星几个格子的误判/边角），不当作一栋楼
const MIN_CELLS = 8

const seen = new Uint8Array(MAP_W * MAP_H)
const comps = []

for (let y = 0; y < MAP_H; y++) {
  for (let x = 0; x < MAP_W; x++) {
    const start = y * MAP_W + x
    const cat = GRID[start]
    if (seen[start] || (cat !== CAT.TAN && cat !== CAT.BLUE)) continue

    seen[start] = 1
    const stack = [start]
    let cells = 0
    let catTan = 0
    let catBlue = 0
    let minX = x
    let maxX = x
    let minY = y
    let maxY = y

    while (stack.length) {
      const i = stack.pop()
      const ix = i % MAP_W
      const iy = (i - ix) / MAP_W
      cells++
      if (GRID[i] === CAT.BLUE) catBlue++
      else catTan++
      if (ix < minX) minX = ix
      if (ix > maxX) maxX = ix
      if (iy < minY) minY = iy
      if (iy > maxY) maxY = iy

      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = ix + dx
        const ny = iy + dy
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue
        const n = ny * MAP_W + nx
        if (seen[n]) continue
        const c = GRID[n]
        if (c !== CAT.TAN && c !== CAT.BLUE) continue
        seen[n] = 1
        stack.push(n)
      }
    }

    const w = maxX - minX + 1
    const h = maxY - minY + 1
    comps.push({
      cat: catBlue > catTan ? 'dorm' : 'teach',
      cell: [minX, minY, w, h],
      cells,
      fill: Math.round((cells / (w * h)) * 100) / 100,
    })
  }
}

const buildings = comps
  .filter((c) => c.cells >= MIN_CELLS)
  .sort((a, b) => a.cell[1] - b.cell[1] || a.cell[0] - b.cell[0])
  .map((c, i) => ({
    id: 'b' + String(i + 1).padStart(2, '0'),
    cat: c.cat,
    cell: c.cell,
    world: [c.cell[0] * CELL, c.cell[1] * CELL, c.cell[2] * CELL, c.cell[3] * CELL],
    cells: c.cells,
    fill: c.fill,
    // 下面两项是留给内容同学的：填上就会在页面里显示
    name: null,
    intro: null,
  }))

writeFileSync(new URL('../src/buildings.json', import.meta.url), JSON.stringify(buildings, null, 2) + '\n')

const frags = comps.filter((c) => c.cells < MIN_CELLS)
console.log(`连通域 ${comps.length} 个 → 建筑 ${buildings.length} 栋（碎片 ${frags.length} 个已忽略，阈值 ${MIN_CELLS} 格）`)
console.log(`教学楼 ${buildings.filter((b) => b.cat === 'teach').length} 栋，宿舍楼 ${buildings.filter((b) => b.cat === 'dorm').length} 栋`)
for (const b of buildings) {
  console.log(`${b.id} ${b.cat.padEnd(5)} cell=${b.cell.join(',')} cells=${String(b.cells).padStart(4)} fill=${b.fill} 名字=${b.name ?? '待补'}`)
}
console.log('wrote src/buildings.json')

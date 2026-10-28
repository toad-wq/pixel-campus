import './style.css'
import { CELL, WORLD_W, WORLD_H } from './ground.js'
import { CHUNK, CHUNKS_X, CHUNKS_Y, bakeChunk, clearCache } from './chunk.js'
import { BUILDINGS, BUILDING_COUNT, clearCells, describe, paintCells, pickBuilding } from './inspect.js'
import { createViewport } from './viewport.js'
import { createMinimap } from './minimap.js'

const app = document.querySelector('#app')

// 画框的宽高比跟着地图走：窄屏正好铺满宽度，宽屏被 72vh 卡住时宽度也一起收，
// 这样任何窗口下地图都正好填满画框，不会出现大片黑边。
document.documentElement.style.setProperty('--world-ratio', String(WORLD_W / WORLD_H))

app.innerHTML = `
  <header>
    <h1>像素校园 · ${WORLD_W} × ${WORLD_H}</h1>
    <p>延边大学建筑分布图 · 星露谷像素风重绘</p>
  </header>

  <div class="stage" id="stage">
    <div class="map" id="map">
      <canvas id="world" width="${WORLD_W}" height="${WORLD_H}"></canvas>
      <canvas id="overlay" width="${WORLD_W}" height="${WORLD_H}"></canvas>
    </div>
    <div class="hud" id="hud">格 —</div>
    <div class="minimap" id="minimap" title="点一下跳过去">
      <canvas id="minimapCanvas"></canvas>
      <div class="minimap-box" id="minimapBox"></div>
    </div>
  </div>

  <div id="inspect" class="inspect">
    <h2 id="inspectTitle">建筑信息</h2>
    <p id="inspectBody"></p>
  </div>

  <div class="toolbar">
    <label><input type="checkbox" id="bounds" checked /> 显示分块边界</label>
    <button id="rebake" type="button">清空缓存 · 重新烘焙</button>
    <span class="zoom">
      <button id="zoomOut" type="button" title="缩小（减号）">−</button>
      <span id="zoomLabel">100%</span>
      <button id="zoomIn" type="button" title="放大（加号）">+</button>
    </span>
    <button id="zoomFit" type="button" title="适应屏幕（0）">适应屏幕</button>
  </div>

  <p id="info" class="info">准备中…</p>

  <div id="thumbs" class="thumbs"></div>

  <ul class="legend">
    <li><i style="background:#64a847"></i>草地</li>
    <li><i style="background:#e9e3d2"></i>铺装 / 道路</li>
    <li><i style="background:#4c9a42"></i>绿地</li>
    <li><i style="background:#c0603a"></i>教学楼</li>
    <li><i style="background:#4a6fa5"></i>宿舍楼</li>
  </ul>

  <footer>拖拽平移 · 滚轮 / 双指缩放 · 双击放大 · 0 适应屏幕 · 方向键微调 —— 每块只烘焙一次，之后只做 drawImage</footer>
`

const stage = document.querySelector('#stage')
const map = document.querySelector('#map')
const world = document.querySelector('#world')
const overlay = document.querySelector('#overlay')
const ctx = world.getContext('2d')
ctx.imageSmoothingEnabled = false

map.style.width = `${WORLD_W}px`
map.style.height = `${WORLD_H}px`

const boundsBox = document.querySelector('#bounds')
const infoEl = document.querySelector('#info')
const thumbsEl = document.querySelector('#thumbs')
const hud = document.querySelector('#hud')
const zoomLabel = document.querySelector('#zoomLabel')

let chunks = []
let minimap = null

// —— 视口：拖拽 / 滚轮 / 双指 / 键盘，只改 transform，不重画像素 ——
const viewport = createViewport({
  stage,
  map,
  worldW: WORLD_W,
  worldH: WORLD_H,
  onChange: ({ zoom }) => {
    zoomLabel.textContent = Math.round(zoom * 100) + '%'
    if (minimap) minimap.sync()
  },
})

// 把纹理贴到主画布上（运行时每帧只做这件事）
function compose() {
  ctx.clearRect(0, 0, world.width, world.height)
  for (const ch of chunks) {
    ctx.drawImage(ch.canvas, ch.cx * CHUNK, ch.cy * CHUNK)
  }
  if (boundsBox.checked) drawBounds()
}

// 画分块边界（虚线）
function drawBounds() {
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
  ctx.setLineDash([6, 6])
  ctx.lineWidth = 1
  for (let i = 1; i < CHUNKS_X; i++) {
    const x = i * CHUNK + 0.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, world.height)
    ctx.stroke()
  }
  for (let i = 1; i < CHUNKS_Y; i++) {
    const y = i * CHUNK + 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(world.width, y)
    ctx.stroke()
  }
  ctx.restore()
}

// 把纹理原样摆出来
function renderThumbs() {
  thumbsEl.innerHTML = ''
  for (const ch of chunks) {
    const fig = document.createElement('figure')
    ch.canvas.className = 'thumb'
    fig.appendChild(ch.canvas)
    const cap = document.createElement('figcaption')
    cap.textContent = `chunk ${ch.cx},${ch.cy}`
    fig.appendChild(cap)
    thumbsEl.appendChild(fig)
  }
}

function bakeAll() {
  clearCache()
  chunks = []
  const t0 = performance.now()
  for (let cy = 0; cy < CHUNKS_Y; cy++) {
    for (let cx = 0; cx < CHUNKS_X; cx++) {
      chunks.push(bakeChunk(cx, cy))
    }
  }
  const total = performance.now() - t0

  compose()
  renderThumbs()
  infoEl.textContent = `预烘焙 ${chunks.length} 块，总耗时 ${total.toFixed(1)}ms`
  if (minimap) {
    minimap.paintBase()
    minimap.sync()
  }
}

// —— 建筑信息层：点一下楼，就在面板里看它是第几号、多大、叫什么 ——
const inspectEl = document.querySelector('#inspect')
const inspectTitle = document.querySelector('#inspectTitle')
const inspectBody = document.querySelector('#inspectBody')

let hovered = null
let selected = null

// 面板内容 = 「选中的楼」优先，没有选中就用「鼠标指着的楼」。
// 顺手把状态写进 dataset：CSS 能据此高亮，自动化测试也能区分
// 「只是悬停」和「真的选中了」——两者标题文字是一样的。
function syncInspect() {
  const target = selected || hovered
  if (target) {
    const d = describe(target.building, target.bbox, target.cells)
    inspectTitle.textContent = d.title
    inspectBody.textContent = d.lines.join(' · ')
  } else {
    const named = BUILDINGS.filter((b) => b.name).length
    inspectTitle.textContent = '建筑信息'
    inspectBody.textContent =
      `认出了 ${BUILDING_COUNT} 栋楼，其中 ${named} 栋有名字。` +
      '点一下楼看编号 —— 名字和一句话简介在 src/buildings.json 里填。'
  }
  inspectEl.dataset.state = selected ? 'selected' : hovered ? 'hover' : 'idle'
  inspectEl.dataset.selected = selected ? selected.building?.id || 'unlisted' : ''
}

function drawOverlay() {
  clearCells(overlay)
  if (selected) paintCells(overlay, selected.cells, 'rgba(255, 214, 92, 0.42)', 'rgba(255, 214, 92, 0.9)')
  if (hovered) paintCells(overlay, hovered.cells, 'rgba(255, 255, 255, 0.2)', 'rgba(255, 255, 255, 0.75)')
}

function cellUnder(ev) {
  const rect = world.getBoundingClientRect()
  const x = ((ev.clientX - rect.left) / rect.width) * world.width
  const y = ((ev.clientY - rect.top) / rect.height) * world.height
  return { cx: Math.floor(x / CELL), cy: Math.floor(y / CELL) }
}

function isSame(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  return a.cells.length === b.cells.length && a.cells[0] === b.cells[0]
}

world.addEventListener('pointermove', (ev) => {
  if (viewport.getDragging()) return
  const { cx, cy } = cellUnder(ev)
  hud.textContent = `格 ${cx}, ${cy} · 像素 ${cx * CELL}, ${cy * CELL}`
  const hit = pickBuilding(cx, cy)
  if (isSame(hit, hovered)) return
  hovered = hit
  drawOverlay()
  syncInspect()
})

world.addEventListener('pointerleave', () => {
  hud.textContent = '格 —'
  hovered = null
  drawOverlay()
  syncInspect()
})

world.addEventListener('click', (ev) => {
  if (viewport.takeDragFlag()) return // 刚刚是在拖地图，不是点建筑
  const { cx, cy } = cellUnder(ev)
  const hit = pickBuilding(cx, cy)
  selected = isSame(hit, selected) ? null : hit
  drawOverlay()
  syncInspect()
})

syncInspect()

boundsBox.addEventListener('change', compose)
document.querySelector('#rebake').addEventListener('click', bakeAll)
document.querySelector('#zoomIn').addEventListener('click', () => viewport.zoomIn())
document.querySelector('#zoomOut').addEventListener('click', () => viewport.zoomOut())
document.querySelector('#zoomFit').addEventListener('click', () => viewport.fit())

// —— 小地图：全图缩略 + 视口方框，点一下就跳过去 ——
minimap = createMinimap({
  el: document.querySelector('#minimap'),
  canvas: document.querySelector('#minimapCanvas'),
  box: document.querySelector('#minimapBox'),
  world,
  worldW: WORLD_W,
  worldH: WORLD_H,
  viewport,
})

bakeAll()
viewport.fit()

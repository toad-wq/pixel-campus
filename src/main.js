import './style.css'
import { CELL, WORLD_W, WORLD_H } from './ground.js'
import { CHUNK, CHUNKS_X, CHUNKS_Y, bakeChunk, clearCache } from './chunk.js'
import { BUILDINGS, BUILDING_COUNT, clearCells, describe, paintCells, pickBuilding } from './inspect.js'

const app = document.querySelector('#app')

app.innerHTML = `
  <header>
    <h1>像素校园 · ${WORLD_W} × ${WORLD_H}</h1>
    <p>延边大学建筑分布图 · 星露谷像素风重绘</p>
  </header>

  <div class="stage">
    <canvas id="world" width="${WORLD_W}" height="${WORLD_H}"></canvas>
    <canvas id="overlay" width="${WORLD_W}" height="${WORLD_H}"></canvas>
  </div>

  <div id="inspect" class="inspect">
    <h2 id="inspectTitle">建筑信息</h2>
    <p id="inspectBody"></p>
  </div>

  <div class="toolbar">
    <label><input type="checkbox" id="bounds" checked /> 显示分块边界</label>
    <button id="rebake" type="button">清空缓存 · 重新烘焙</button>
    <span class="zoom">
      <button id="zoomOut" type="button" title="缩小">−</button>
      <span id="zoomLabel">100%</span>
      <button id="zoomIn" type="button" title="放大">+</button>
    </span>
    <button id="zoomFit" type="button">适应屏幕</button>
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

  <footer>每块只烘焙一次，之后只做 drawImage —— 这就是「烘焙式分块渲染」</footer>
`

const world = document.querySelector('#world')
const ctx = world.getContext('2d')
ctx.imageSmoothingEnabled = false

const boundsBox = document.querySelector('#bounds')
const infoEl = document.querySelector('#info')
const thumbsEl = document.querySelector('#thumbs')

let chunks = []

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
}

// —— 建筑信息层：点一下楼，就在面板里看它是第几号、多大、叫什么 ——
const overlay = document.querySelector('#overlay')
const inspectTitle = document.querySelector('#inspectTitle')
const inspectBody = document.querySelector('#inspectBody')

let hovered = null
let selected = null

function showDefaultInspect() {
  const named = BUILDINGS.filter((b) => b.name).length
  inspectTitle.textContent = '建筑信息'
  inspectBody.textContent =
    `认出了 ${BUILDING_COUNT} 栋楼，其中 ${named} 栋有名字。` +
    '点一下楼看编号 —— 名字和一句话简介在 src/buildings.json 里填。'
}

function showInspect(target) {
  if (!target) return showDefaultInspect()
  const d = describe(target.building, target.bbox, target.cells)
  inspectTitle.textContent = d.title
  inspectBody.textContent = d.lines.join(' · ')
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
  const { cx, cy } = cellUnder(ev)
  const hit = pickBuilding(cx, cy)
  if (isSame(hit, hovered)) return
  hovered = hit
  drawOverlay()
  showInspect(selected || hovered)
})

world.addEventListener('pointerleave', () => {
  hovered = null
  drawOverlay()
  showInspect(selected)
})

world.addEventListener('click', (ev) => {
  const { cx, cy } = cellUnder(ev)
  const hit = pickBuilding(cx, cy)
  selected = isSame(hit, selected) ? null : hit
  drawOverlay()
  showInspect(selected)
})

showDefaultInspect()

boundsBox.addEventListener('change', compose)
document.querySelector('#rebake').addEventListener('click', bakeAll)

// 缩放：默认适应屏幕（100%），可放大到 400%
let zoom = 1
const zoomLabel = document.querySelector('#zoomLabel')
function applyZoom() {
  document.documentElement.style.setProperty('--zoom', String(zoom))
  zoomLabel.textContent = Math.round(zoom * 100) + '%'
}
document.querySelector('#zoomIn').addEventListener('click', () => {
  zoom = Math.min(4, zoom + 0.25)
  applyZoom()
})
document.querySelector('#zoomOut').addEventListener('click', () => {
  zoom = Math.max(0.5, zoom - 0.25)
  applyZoom()
})
document.querySelector('#zoomFit').addEventListener('click', () => {
  zoom = 1
  applyZoom()
})
applyZoom()

bakeAll()

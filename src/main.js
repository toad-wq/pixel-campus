import './style.css'
import { WORLD_W, WORLD_H } from './ground.js'
import { CHUNK, CHUNKS_X, CHUNKS_Y, bakeChunk, clearCache } from './chunk.js'

const app = document.querySelector('#app')

app.innerHTML = `
  <header>
    <h1>像素校园 · ${WORLD_W} × ${WORLD_H}</h1>
    <p>延边大学建筑分布图 · 星露谷像素风重绘</p>
  </header>

  <div class="stage">
    <canvas id="world" width="${WORLD_W}" height="${WORLD_H}"></canvas>
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

// 小地图：整张校园的缩略图 + 当前视口的方框。
// 点一下（或按住拖）小地图，主视图就跳过去 —— 放大到 300% 以后
// 这是唯一能告诉你「我现在在校园哪个角落」的东西。

const clamp01 = (v) => Math.min(1, Math.max(0, v))

export function createMinimap({ el, canvas, box, world, worldW, worldH, viewport }) {
  const ctx = canvas.getContext('2d')
  let dragging = false

  // 主画布合成完以后调用一次：把整张图缩到小地图上
  function paintBase() {
    if (canvas.width !== worldW || canvas.height !== worldH) {
      canvas.width = worldW
      canvas.height = worldH
    }
    ctx.imageSmoothingEnabled = true
    ctx.clearRect(0, 0, worldW, worldH)
    ctx.drawImage(world, 0, 0)
  }

  // 视口变化时调用：把方框摆到正确的位置和大小
  function sync() {
    const { zoom, tx, ty, viewW, viewH } = viewport.getState()
    const w = worldW * zoom
    const h = worldH * zoom
    const left = clamp01(-tx / w)
    const top = clamp01(-ty / h)
    // 方框 = 画框能看到的那一块，占整张图的比例
    const bw = Math.min(1, viewW / w)
    const bh = Math.min(1, viewH / h)
    box.style.left = left * 100 + '%'
    box.style.top = top * 100 + '%'
    box.style.width = bw * 100 + '%'
    box.style.height = bh * 100 + '%'
  }

  function jumpTo(ev) {
    const r = el.getBoundingClientRect()
    const wx = clamp01((ev.clientX - r.left) / r.width) * worldW
    const wy = clamp01((ev.clientY - r.top) / r.height) * worldH
    viewport.centerOn(wx, wy)
  }

  el.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation()
    ev.preventDefault()
    dragging = true
    el.setPointerCapture(ev.pointerId)
    jumpTo(ev)
  })
  el.addEventListener('pointermove', (ev) => {
    if (!dragging) return
    ev.stopPropagation()
    jumpTo(ev)
  })
  const stop = (ev) => {
    dragging = false
    ev.stopPropagation()
  }
  el.addEventListener('pointerup', stop)
  el.addEventListener('pointercancel', stop)
  el.addEventListener('click', (ev) => ev.stopPropagation())

  return { paintBase, sync }
}

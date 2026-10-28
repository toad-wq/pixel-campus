// 视口（相机）：把一张固定尺寸的像素图，放进任意大小的画框里。
//
// 这里只做一件事：决定「世界里的哪一块，以多大比例，落在画框的哪个位置」。
// 拖拽、滚轮、双指、双击、键盘全部只改 transform —— 一个像素都不重画，
// 所以再大的地图、再快的操作也掉不了帧。
//
// 以后接 1 米/格的地图和角色时，角色永远画在视口中心，镜头跟随也只需要
// 调 centerOn(worldX, worldY)：这一层的接口到那时不用改。

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 4

const ZOOM_STEP = 1.25
const WHEEL_SENS = 0.0015 // 滚一格大约 1.16 倍
const DRAG_SLOP = 4 // 手指/鼠标移动超过这个距离才算拖拽，否则算点击
const KEY_PAN = 80

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export function createViewport({ stage, map, worldW, worldH, onChange = () => {} }) {
  let zoom = 1
  let tx = 0
  let ty = 0
  let autoFit = true
  let drag = null
  let pinch = null
  let moved = false // 本次按下之后是否真的拖动过（决定 cursor 和 click 是否算点选）
  // 这一次手势是「拖」还是「点」：拖过的那一下 click 必须丢掉。
  // 用标记而不是定时器 —— 浏览器未必在 pointerup 后 0ms 内派发 click，
  // 定时器可能先跑，click 就漏进来了（会误选建筑）。
  let gestureDragged = false
  const pointers = new Map()

  const viewW = () => stage.clientWidth || 1
  const viewH = () => stage.clientHeight || 1

  // 地图比画框小的时候居中，比画框大的时候不许拖出黑边
  function clampPan() {
    const w = worldW * zoom
    const h = worldH * zoom
    tx = w <= viewW() ? (viewW() - w) / 2 : clamp(tx, viewW() - w, 0)
    ty = h <= viewH() ? (viewH() - h) / 2 : clamp(ty, viewH() - h, 0)
  }

  function paint() {
    map.style.transform = `translate3d(${Math.round(tx)}px, ${Math.round(ty)}px, 0) scale(${zoom})`
    onChange({ zoom, tx, ty, viewW: viewW(), viewH: viewH() })
  }

  // 以画框内某个点为中心缩放：那个点下面的世界像素保持不动
  function setZoomAt(next, sx, sy) {
    next = clamp(next, MIN_ZOOM, MAX_ZOOM)
    if (Math.abs(next - zoom) < 1e-6) return
    const k = next / zoom
    tx = sx - (sx - tx) * k
    ty = sy - (sy - ty) * k
    zoom = next
    autoFit = false
    clampPan()
    paint()
  }

  function fit() {
    autoFit = true
    zoom = clamp(Math.min(viewW() / worldW, viewH() / worldH), MIN_ZOOM, MAX_ZOOM)
    tx = (viewW() - worldW * zoom) / 2
    ty = (viewH() - worldH * zoom) / 2
    clampPan()
    paint()
  }

  function centerOn(wx, wy) {
    autoFit = false
    tx = viewW() / 2 - wx * zoom
    ty = viewH() / 2 - wy * zoom
    clampPan()
    paint()
  }

  function panBy(dx, dy) {
    autoFit = false
    tx += dx
    ty += dy
    clampPan()
    paint()
  }

  function local(ev) {
    const r = stage.getBoundingClientRect()
    return { x: ev.clientX - r.left, y: ev.clientY - r.top }
  }

  // —— 指针：单指/左键拖拽平移，双指捏合缩放 + 平移 ——
  function onPointerDown(ev) {
    if (ev.button > 0) return
    pointers.set(ev.pointerId, local(ev))
    if (pointers.size === 1) {
      const p = local(ev)
      moved = false
      gestureDragged = false // 新手势开始，清掉上一次遗留的标记
      drag = { sx: p.x, sy: p.y, tx, ty, id: ev.pointerId }
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y),
        z: zoom,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      }
      drag = null
    }
  }

  function onPointerMove(ev) {
    if (!pointers.has(ev.pointerId)) return
    const p = local(ev)
    pointers.set(ev.pointerId, p)

    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      if (pinch.d > 0 && d > 0) setZoomAt(pinch.z * (d / pinch.d), mid.x, mid.y)
      if (mid.x !== pinch.mid.x || mid.y !== pinch.mid.y) {
        tx += mid.x - pinch.mid.x
        ty += mid.y - pinch.mid.y
        clampPan()
        paint()
      }
      pinch.mid = mid
      return
    }

    if (!drag) return
    const dx = p.x - drag.sx
    const dy = p.y - drag.sy
    if (!moved && Math.hypot(dx, dy) < DRAG_SLOP) return
    if (!moved) stage.classList.add('is-dragging')
    moved = true
    autoFit = false
    tx = drag.tx + dx
    ty = drag.ty + dy
    clampPan()
    paint()
  }

  function onPointerUp(ev) {
    pointers.delete(ev.pointerId)
    if (pointers.size < 2) pinch = null
    if (pointers.size === 0) {
      drag = null
      // 拖动结束：紧接着的那一下 click 不能算「点选建筑」。
      // 但 hover 必须立刻恢复，所以「拖动中」和「吞掉 click」是两个变量。
      gestureDragged = moved
      moved = false
      stage.classList.remove('is-dragging')
    } else {
      const p = [...pointers.values()][0]
      drag = { sx: p.x, sy: p.y, tx, ty, id: [...pointers.keys()][0] }
    }
  }

  // —— 滚轮 / 触控板：缩放；shift 或横向滚动则平移 ——
  function onWheel(ev) {
    ev.preventDefault()
    if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
      panBy(-(ev.deltaX || ev.deltaY), 0)
      return
    }
    const p = local(ev)
    setZoomAt(zoom * Math.exp(-ev.deltaY * WHEEL_SENS), p.x, p.y)
  }

  function onDblClick(ev) {
    ev.preventDefault()
    const p = local(ev)
    setZoomAt(ev.shiftKey ? zoom / 1.6 : zoom * 1.6, p.x, p.y)
  }

  function onKey(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target?.tagName || '')) return
    const c = { x: viewW() / 2, y: viewH() / 2 }
    switch (ev.key) {
      case '+':
      case '=':
        setZoomAt(zoom * ZOOM_STEP, c.x, c.y)
        break
      case '-':
      case '_':
        setZoomAt(zoom / ZOOM_STEP, c.x, c.y)
        break
      case '0':
      case 'f':
      case 'F':
        fit()
        break
      case 'ArrowLeft':
        panBy(KEY_PAN, 0)
        break
      case 'ArrowRight':
        panBy(-KEY_PAN, 0)
        break
      case 'ArrowUp':
        panBy(0, KEY_PAN)
        break
      case 'ArrowDown':
        panBy(0, -KEY_PAN)
        break
      default:
        return
    }
    ev.preventDefault()
  }

  function resize() {
    if (autoFit) fit()
    else {
      clampPan()
      paint()
    }
  }

  // 拖动时手指/鼠标可能滑出画框，所以 move/up 挂在 window 上；
  // 不用 pointer capture，否则 click 会被改派到画框上，点选建筑就失效了。
  stage.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  stage.addEventListener('wheel', onWheel, { passive: false })
  stage.addEventListener('dblclick', onDblClick)
  window.addEventListener('keydown', onKey)
  const ro = new ResizeObserver(resize)
  ro.observe(stage)
  // 双指缩放时阻止浏览器整页放大（Safari）
  stage.addEventListener('gesturestart', (ev) => ev.preventDefault())

  return {
    fit,
    centerOn,
    panBy,
    zoomIn: () => setZoomAt(zoom * ZOOM_STEP, viewW() / 2, viewH() / 2),
    zoomOut: () => setZoomAt(zoom / ZOOM_STEP, viewW() / 2, viewH() / 2),
    setZoom: (z) => setZoomAt(z, viewW() / 2, viewH() / 2),
    getState: () => ({ zoom, tx, ty, viewW: viewW(), viewH: viewH() }),
    getDragging: () => moved,
    // 拖动结束后的那一下 click 不该被当成「点选建筑」
    takeDragFlag: () => {
      const v = gestureDragged
      gestureDragged = false
      return v
    },
    destroy() {
      ro.disconnect()
      window.removeEventListener('keydown', onKey)
    },
  }
}

// 像素绘制库 —— 整个项目的地基。
// 思路：不画图，而是直接往一块「颜色数组」里填 uint32，最后一次性丢给 canvas。
//
// 关键：小端序下，一个像素的 uint32 = (a<<24)|(b<<16)|(g<<8)|r
// 顺序是 A-B-G-R，别记成 RGBA，否则颜色全错。
//
// 分块渲染：帧缓冲带一个「世界原点」(originX, originY)。
// 这样同一份绘制代码既能画整张 512×512，也能只画某一块 256×256，
// 落在块外的像素会被 setPixel 自动裁掉。

export function pack(hex, a = 255) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

// 可复现的伪随机数：同一个 seed 永远得到同一串数，
// 这样每次刷新地面纹理都一样，不会「闪」。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 把 canvas 包成「帧缓冲」：img 是 ImageData，buf 是它的 uint32 视图。
// originX/originY 表示这块缓冲对应世界坐标里的左上角。
export function createFramebuffer(canvas, originX = 0, originY = 0) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const width = canvas.width;
  const height = canvas.height;
  const img = ctx.createImageData(width, height);
  const buf = new Uint32Array(img.data.buffer);
  return { canvas, ctx, img, buf, width, height, originX, originY };
}

// 用「世界坐标」写一个像素；自动换算到块内坐标并裁剪。
export function setPixel(fb, x, y, color) {
  const ox = fb.originX ?? 0;
  const oy = fb.originY ?? 0;
  const lx = (x | 0) - ox;
  const ly = (y | 0) - oy;
  if (lx < 0 || ly < 0 || lx >= fb.width || ly >= fb.height) return;
  fb.buf[ly * fb.width + lx] = color;
}

export function fillRect(fb, x, y, w, h, color) {
  const ox = fb.originX ?? 0;
  const oy = fb.originY ?? 0;
  const x0 = Math.max(0, (x | 0) - ox);
  const y0 = Math.max(0, (y | 0) - oy);
  const x1 = Math.min(fb.width, (x | 0) + (w | 0) - ox);
  const y1 = Math.min(fb.height, (y | 0) + (h | 0) - oy);
  for (let py = y0; py < y1; py++) {
    const row = py * fb.width;
    for (let px = x0; px < x1; px++) fb.buf[row + px] = color;
  }
}

// 把内存里的像素一次性贴到屏幕。
export function present(fb) {
  fb.ctx.putImageData(fb.img, 0, 0);
}

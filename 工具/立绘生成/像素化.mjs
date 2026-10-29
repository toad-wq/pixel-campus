// 真像素化：把一张图压成「固定网格 + 有限色板」的 sprite。
//
// 顺序不能反：抠背景 → 按网格做区域平均降采样 → 限色板 → 最近邻放大。
// 先放大再点上像素点，得到的是马赛克滤镜；先对齐网格再限色，才是像素画。
//
// 输入输出都是裸 RGBA（Uint8ClampedArray + 宽高），浏览器和 Node 都能跑，
// 这样同一份代码既能给页面用，也能在命令行批处理。

export const 默认参数 = {
  宽: 48,
  高: 64,
  颜色数: 24,
  抖动: false,
  抠背景: true,
  容差: 64,
  自动裁剪: true,
  对齐脚底: true,
  缩放: 1,
  偏移X: 0,
  偏移Y: 0,
  亮度: 0,
  对比度: 0,
  饱和度: 0,
}

// 取像素，越界就夹到边上，省得每处都判空。
function 取(数据, 宽, 高, x, y) {
  const cx = x < 0 ? 0 : x >= 宽 ? 宽 - 1 : x
  const cy = y < 0 ? 0 : y >= 高 ? 高 - 1 : y
  const i = (cy * 宽 + cx) * 4
  return [数据[i], 数据[i + 1], 数据[i + 2], 数据[i + 3]]
}

// 抠背景：拿外圈像素投票选出背景色，再把接近它的像素变成全透明。
// AI 出图时我们要求纯品红背景，这一步就能一把抠干净；照片也能用，只是会抠掉接近的色块。
export function 抠背景(源, 容差 = 64) {
  const { 数据, 宽, 高 } = 源
  const 计数 = new Map()
  const 投票 = (x, y) => {
    const [r, g, b] = 取(数据, 宽, 高, x, y)
    const 键 = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const 项 = 计数.get(键) ?? { 数: 0, r: 0, g: 0, b: 0 }
    项.数++
    项.r += r
    项.g += g
    项.b += b
    计数.set(键, 项)
  }
  const 边 = Math.max(1, Math.round(Math.min(宽, 高) * 0.02))
  for (let x = 0; x < 宽; x++) {
    for (let d = 0; d < 边; d++) {
      投票(x, d)
      投票(x, 高 - 1 - d)
    }
  }
  for (let y = 0; y < 高; y++) {
    for (let d = 0; d < 边; d++) {
      投票(d, y)
      投票(宽 - 1 - d, y)
    }
  }
  let 最多 = null
  for (const 项 of 计数.values()) if (!最多 || 项.数 > 最多.数) 最多 = 项
  const 背景色 = [最多.r / 最多.数, 最多.g / 最多.数, 最多.b / 最多.数]

  const 出 = new Uint8ClampedArray(数据.length)
  let 抠掉 = 0
  for (let i = 0; i < 数据.length; i += 4) {
    const dr = 数据[i] - 背景色[0]
    const dg = 数据[i + 1] - 背景色[1]
    const db = 数据[i + 2] - 背景色[2]
    const 距 = Math.sqrt(dr * dr + dg * dg + db * db)
    出[i] = 数据[i]
    出[i + 1] = 数据[i + 1]
    出[i + 2] = 数据[i + 2]
    if (距 <= 容差) {
      出[i + 3] = 0
      抠掉++
    } else {
      出[i + 3] = 数据[i + 3]
    }
  }
  return {
    图: { 数据: 出, 宽, 高 },
    背景色,
    抠除比例: 抠掉 / (宽 * 高),
  }
}

// 把一个框收进画面内；放不下就等比缩小，别把长宽比弄坏。
function 收进画面(框, 宽, 高) {
  let w = 框.宽
  let h = 框.高
  const 比 = Math.min(1, 宽 / w, 高 / h)
  w *= 比
  h *= 比
  let x = 框.x + (框.宽 - w) / 2
  let y = 框.y + (框.高 - h) / 2
  x = Math.min(Math.max(0, x), 宽 - w)
  y = Math.min(Math.max(0, y), 高 - h)
  return { x, y, 宽: w, 高: h }
}

// 自动裁剪：找不透明像素的包围盒，留一点边距，再按目标长宽比补成矩形。
export function 主体框(源, 宽高比) {
  const { 数据, 宽, 高 } = 源
  let x0 = 宽
  let y0 = 高
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < 高; y++) {
    for (let x = 0; x < 宽; x++) {
      if (数据[(y * 宽 + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  const 边 = Math.round(Math.max(x1 - x0 + 1, y1 - y0 + 1) * 0.06)
  x0 -= 边
  y0 -= 边
  x1 += 边
  y1 += 边
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  let w = x1 - x0
  let h = y1 - y0
  if (w / h < 宽高比) w = h * 宽高比
  else h = w / 宽高比
  return 收进画面({ x: cx - w / 2, y: cy - h / 2, 宽: w, 高: h }, 宽, 高)
}

// 手动取景：整幅画面按目标长宽比居中裁一块，再叠缩放和偏移。
export function 取景框(宽, 高, 宽高比, 缩放 = 1, 偏移X = 0, 偏移Y = 0) {
  let w = 宽
  let h = 宽 / 宽高比
  if (h > 高) {
    h = 高
    w = 高 * 宽高比
  }
  const 系数 = 1 / Math.max(0.2, 缩放)
  w *= 系数
  h *= 系数
  return 收进画面(
    { x: (宽 - w) / 2 + 偏移X * w, y: (高 - h) / 2 + 偏移Y * h, 宽: w, 高: h },
    宽,
    高,
  )
}

// 区域平均降采样：每个目标像素吃掉框里一小块，按透明度加权平均。
// 直接 drawImage 缩图会把透明边缘和背景色混进来，所以自己算。
export function 采样(源, 框, 宽, 高) {
  const { 数据, 宽: 源宽, 高: 源高 } = 源
  const 出 = new Uint8ClampedArray(宽 * 高 * 4)
  const 块宽 = 框.宽 / 宽
  const 块高 = 框.高 / 高
  for (let y = 0; y < 高; y++) {
    const y0 = 框.y + y * 块高
    const y1 = y0 + 块高
    for (let x = 0; x < 宽; x++) {
      const x0 = 框.x + x * 块宽
      const x1 = x0 + 块宽
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let 数 = 0
      const syStart = Math.max(0, Math.floor(y0))
      const syEnd = Math.min(源高, Math.ceil(y1))
      const sxStart = Math.max(0, Math.floor(x0))
      const sxEnd = Math.min(源宽, Math.ceil(x1))
      for (let sy = syStart; sy < syEnd; sy++) {
        // 用像素中心判断落在块内，避免块边界重复计数
        if (sy + 0.5 < y0 || sy + 0.5 >= y1) continue
        for (let sx = sxStart; sx < sxEnd; sx++) {
          if (sx + 0.5 < x0 || sx + 0.5 >= x1) continue
          const i = (sy * 源宽 + sx) * 4
          const al = 数据[i + 3] / 255
          r += 数据[i] * al
          g += 数据[i + 1] * al
          b += 数据[i + 2] * al
          a += al
          数++
        }
      }
      const 出i = (y * 宽 + x) * 4
      if (!数 || a <= 0) continue
      const 平均透明度 = a / 数
      出[出i] = r / a
      出[出i + 1] = g / a
      出[出i + 2] = b / a
      // 硬边：半透明一律砍成 0/255，否则放大后会出现一圈灰边
      出[出i + 3] = 平均透明度 >= 0.4 ? 255 : 0
    }
  }
  return { 数据: 出, 宽, 高 }
}

// 亮度 / 对比度 / 饱和度，参数都是 -100 ~ 100。
export function 调色(r, g, b, { 亮度, 对比度, 饱和度 }) {
  const 灰 = 0.299 * r + 0.587 * g + 0.114 * b
  const 饱和 = 1 + 饱和度 / 100
  r = 灰 + (r - 灰) * 饱和
  g = 灰 + (g - 灰) * 饱和
  b = 灰 + (b - 灰) * 饱和
  const 对比 = 1 + 对比度 / 100
  const 加亮 = 亮度 * 1.28
  const 夹 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)
  return [夹((r - 128) * 对比 + 128 + 加亮), 夹((g - 128) * 对比 + 128 + 加亮), 夹((b - 128) * 对比 + 128 + 加亮)]
}

// 中位切分：不断把「颜色跨度最大」的盒子从中间切开，切到 K 个为止。
// 比 k-means 快得多，而且对 3 千个像素的结果足够稳，不引入随机性。
function 量程(点) {
  let r0 = 255, g0 = 255, b0 = 255, r1 = 0, g1 = 0, b1 = 0
  for (const p of 点) {
    if (p[0] < r0) r0 = p[0]
    if (p[0] > r1) r1 = p[0]
    if (p[1] < g0) g0 = p[1]
    if (p[1] > g1) g1 = p[1]
    if (p[2] < b0) b0 = p[2]
    if (p[2] > b1) b1 = p[2]
  }
  const 跨 = [r1 - r0, g1 - g0, b1 - b0]
  let 通道 = 0
  if (跨[1] > 跨[通道]) 通道 = 1
  if (跨[2] > 跨[通道]) 通道 = 2
  return { 通道, 跨度: 跨[通道] }
}

export function 中位切分(点, K) {
  if (!点.length) return []
  let 盒 = [点.slice()]
  while (盒.length < K) {
    let 目标 = -1
    let 最大 = -1
    for (let i = 0; i < 盒.length; i++) {
      if (盒[i].length < 2) continue
      const { 跨度 } = 量程(盒[i])
      if (跨度 > 最大) {
        最大 = 跨度
        目标 = i
      }
    }
    if (目标 < 0) break
    const 当前 = 盒[目标]
    const { 通道 } = 量程(当前)
    当前.sort((p, q) => p[通道] - q[通道])
    const 中 = 当前.length >> 1
    盒.splice(目标, 1, 当前.slice(0, 中), 当前.slice(中))
  }
  return 盒.map((b) => {
    let r = 0
    let g = 0
    let bl = 0
    for (const p of b) {
      r += p[0]
      g += p[1]
      bl += p[2]
    }
    return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)]
  })
}

// 把每个像素压到最近的色板颜色；开了抖动就用 Floyd–Steinberg 扩散误差。
function 最近色(色板, r, g, b) {
  let 最好 = 0
  let 最小 = Infinity
  for (let i = 0; i < 色板.length; i++) {
    const dr = r - 色板[i][0]
    const dg = g - 色板[i][1]
    const db = b - 色板[i][2]
    const 距 = dr * dr + dg * dg + db * db
    if (距 < 最小) {
      最小 = 距
      最好 = i
    }
  }
  return 最好
}

export function 映射(网格, 色板, 抖动) {
  const { 数据, 宽, 高 } = 网格
  const 出 = new Uint8ClampedArray(数据.length)
  const 误差 = 抖动 ? new Float32Array(宽 * 高 * 3) : null
  for (let y = 0; y < 高; y++) {
    for (let x = 0; x < 宽; x++) {
      const i = (y * 宽 + x) * 4
      if (数据[i + 3] === 0) continue
      let r = 数据[i]
      let g = 数据[i + 1]
      let b = 数据[i + 2]
      if (误差) {
        const e = (y * 宽 + x) * 3
        r += 误差[e]
        g += 误差[e + 1]
        b += 误差[e + 2]
      }
      const 索引 = 最近色(色板, r, g, b)
      const 选 = 色板[索引]
      出[i] = 选[0]
      出[i + 1] = 选[1]
      出[i + 2] = 选[2]
      出[i + 3] = 255
      if (误差) {
        const dr = r - 选[0]
        const dg = g - 选[1]
        const db = b - 选[2]
        const 扩散 = (dx, dy, 权) => {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= 宽 || ny < 0 || ny >= 高) return
          const e = (ny * 宽 + nx) * 3
          误差[e] += dr * 权
          误差[e + 1] += dg * 权
          误差[e + 2] += db * 权
        }
        扩散(1, 0, 7 / 16)
        扩散(-1, 1, 3 / 16)
        扩散(0, 1, 5 / 16)
        扩散(1, 1, 1 / 16)
      }
    }
  }
  return { 数据: 出, 宽, 高 }
}

// 全身校验：用几何特征判断「这张图是不是一个完整的全身立绘」。
// 判据（针对抠完背景的图）：
//   1. 主体高度占比要大（半身照通常也大，所以不够）
//   2. 主体底部要贴着画面下沿（被裁掉腿的图往往也贴，所以还不够）
//   3. 底部要变窄 —— 脚/腿比肩膀窄。半身照的底部是肩膀，这是最有效的区分点。
export function 分析全身(源) {
  const { 数据, 宽, 高 } = 源
  const 行宽 = new Int32Array(高)
  let x0 = 宽
  let y0 = 高
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < 高; y++) {
    for (let x = 0; x < 宽; x++) {
      if (数据[(y * 宽 + x) * 4 + 3] > 8) {
        行宽[y]++
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return { 是全身: false, 说明: '没找到主体（背景被抠光了？）', 高度占比: 0, 底部宽度比: 1, 底部留白: 1 }

  const 主体高 = y1 - y0 + 1
  const 高度占比 = 主体高 / 高
  let 最大行宽 = 0
  for (let y = y0; y <= y1; y++) if (行宽[y] > 最大行宽) 最大行宽 = 行宽[y]
  const 底段 = Math.max(1, Math.round(主体高 * 0.08))
  let 底宽和 = 0
  let 底行数 = 0
  for (let y = Math.max(y0, y1 - 底段 + 1); y <= y1; y++) {
    底宽和 += 行宽[y]
    底行数++
  }
  const 底部宽度比 = 最大行宽 ? 底宽和 / 底行数 / 最大行宽 : 1
  const 底部留白 = (高 - 1 - y1) / 高

  const 通过 = 高度占比 > 0.5 && 底部留白 < 0.15 && 底部宽度比 < 0.8
  const 部位 = []
  if (高度占比 <= 0.5) 部位.push(`主体只占画面 ${(高度占比 * 100).toFixed(0)}%`)
  if (底部留白 >= 0.15) 部位.push(`脚下空了 ${(底部留白 * 100).toFixed(0)}%`)
  if (底部宽度比 >= 0.8) 部位.push(`底部和肩一样宽（${(底部宽度比 * 100).toFixed(0)}%），看着像半身`)

  return {
    是全身: 通过,
    高度占比,
    底部宽度比,
    底部留白,
    说明: 通过
      ? `全身构图 OK（高占比 ${(高度占比 * 100).toFixed(0)}%，底部宽度 ${(底部宽度比 * 100).toFixed(0)}%）`
      : `不像全身：${部位.join('；')}`,
  }
}

// 脚底对齐：把最下面一行不透明像素压到画面底边，方便所有立绘共用同一条地面基线。
// 只往下挪，不往上挪 —— 往上挪会把脚切掉。
export function 对齐脚底(网格, 底部留白 = 0) {
  const { 数据, 宽, 高 } = 网格
  let 底 = -1
  for (let y = 高 - 1; y >= 0 && 底 < 0; y--) {
    for (let x = 0; x < 宽; x++) {
      if (数据[(y * 宽 + x) * 4 + 3] > 0) {
        底 = y
        break
      }
    }
  }
  const 目标 = 高 - 1 - Math.max(0, Math.min(底部留白, 高 - 2))
  if (底 < 0 || 底 >= 目标) return 网格
  const 移 = 目标 - 底
  const 出 = new Uint8ClampedArray(数据.length)
  for (let y = 0; y < 高; y++) {
    const 源行 = y - 移
    if (源行 < 0) continue
    for (let x = 0; x < 宽; x++) {
      const 源i = (源行 * 宽 + x) * 4
      if (数据[源i + 3] === 0) continue
      const 出i = (y * 宽 + x) * 4
      出[出i] = 数据[源i]
      出[出i + 1] = 数据[源i + 1]
      出[出i + 2] = 数据[源i + 2]
      出[出i + 3] = 255
    }
  }
  return { 数据: 出, 宽, 高 }
}

// 主入口：源图 + 参数 → 网格 sprite + 色板 + 用到的取景框。
export function 处理(源, 参数 = {}) {
  const p = { ...默认参数, ...参数 }
  const 宽高比 = p.宽 / p.高
  let 图 = 源
  let 抠除比例 = 0
  let 背景色 = null
  if (p.抠背景) {
    const 结果 = 抠背景(源, p.容差)
    图 = 结果.图
    抠除比例 = 结果.抠除比例
    背景色 = 结果.背景色
  }
  const 框 =
    (p.自动裁剪 ? 主体框(图, 宽高比) : null) ?? 取景框(图.宽, 图.高, 宽高比, p.缩放, p.偏移X, p.偏移Y)

  const 网格 = 采样(图, 框, p.宽, p.高)
  const 点 = []
  for (let i = 0; i < 网格.数据.length; i += 4) {
    if (网格.数据[i + 3] === 0) continue
    const [r, g, b] = 调色(网格.数据[i], 网格.数据[i + 1], 网格.数据[i + 2], p)
    网格.数据[i] = r
    网格.数据[i + 1] = g
    网格.数据[i + 2] = b
    点.push([r, g, b])
  }
  const 色板 = 中位切分(点, Math.max(2, Math.min(p.颜色数, 点.length || 2)))
  色板.sort((a, b) => 0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2] - (0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2]))
  let 结果 = 映射(网格, 色板, p.抖动)
  if (p.对齐脚底) 结果 = 对齐脚底(结果)
  return {
    宽: p.宽,
    高: p.高,
    数据: 结果.数据,
    色板,
    框,
    背景色,
    抠除比例,
    有效像素: 点.length,
  }
}

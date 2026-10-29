// 本地小服务：托管页面 + 代理模型调用。
//
// 为什么不让页面直连模型：key 写进浏览器等于公开。这里所有请求都走 /api/*，
// key 只在服务端（进程环境变量或 .env.local），页面只能拿到「有没有配」。
//
// 启动：
//   node 工具/立绘生成/服务端.mjs
// 可选环境变量：
//   AI_PROVIDER=gemini|openai|模拟
//   AI_KEY=...
//   AI_BASE_URL=https://api.openai.com/v1
//   AI_IMAGE_MODEL / AI_TEXT_MODEL
//   AI_ASPECT=3:4  AI_SIZE=1024x1024  AI_TIMEOUT=180
//   立绘端口=5174

import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { 生图提示词, 人设提示词, 全身照片提示词, 像素立绘提示词 } from './提示词.mjs'
import { 生图, 写人设, 读配置, 状态, 存配置, 测连通 } from './模型.mjs'

const 页面目录 = fileURLToPath(new URL('./', import.meta.url))
const 端口 = Number(process.env.立绘端口 ?? process.env.PORT ?? 5174)
const 请求体上限 = 25 * 1024 * 1024

const 类型表 = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
}

// 服务端自己这些文件不往外发
const 不对外 = new Set(['/服务端.mjs', '/模型.mjs', '/.env.local'])

function 返回json(响应, 状态码, 数据) {
  响应.writeHead(状态码, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  响应.end(JSON.stringify(数据))
}

async function 读请求体(请求) {
  const 块们 = []
  let 长度 = 0
  for await (const 块 of 请求) {
    长度 += 块.length
    if (长度 > 请求体上限) throw new Error('请求体太大，图片请压到 2MB 以内')
    块们.push(块)
  }
  const 文本 = Buffer.concat(块们).toString('utf8')
  if (!文本.trim()) return {}
  try {
    return JSON.parse(文本)
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

// 网络层的错误（DNS、拒连、证书）对用户没有信息量，翻译一下
function 译错误(错误) {
  const 文 = String(错误?.message ?? 错误)
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|certificate|socket hang up/i.test(文)) {
    return `连不上模型服务：检查网络、AI_BASE_URL 或代理设置。原始信息：${文}`
  }
  return 文
}

// ---- 接口 ----

async function 处理状态(响应) {
  返回json(响应, 200, await 状态())
}

async function 处理设置(请求, 响应) {
  const 体 = await 读请求体(请求)
  const 配置 = await 存配置({
    提供方: 体.提供方,
    密钥: 体.密钥,
    地址: 体.地址,
    图像模型: 体.图像模型,
    文本模型: 体.文本模型,
    代理: 体.代理,
    清空密钥: 体.清空密钥 === true,
  })
  返回json(响应, 200, {
    已保存: true,
    已写入: '.env.local',
    ...(await 状态()),
    提醒: 配置.提供方 === '模拟' ? '当前是模拟提供方，返回的是示例图。' : '',
  })
}

async function 处理测试(响应) {
  返回json(响应, 200, await 测连通())
}

async function 处理生成(请求, 响应) {
  const 体 = await 读请求体(请求)
  if (!体?.图片) return 返回json(响应, 400, { 错误: '缺少图片字段' })
  // 阶段只决定「没给提示词时用哪段默认」，给了提示词就按页面传的来
  const 默认提示 =
    体.阶段 === '全身' ? 全身照片提示词 : 体.阶段 === '像素' ? 像素立绘提示词 : 生图提示词
  const 结果 = await 生图({
    图片: 体.图片,
    类型: 体.类型 ?? 'image/jpeg',
    提示词: 体.提示词?.trim() || 默认提示,
    比例: 体.比例,
  })
  返回json(响应, 200, 结果)
}

async function 处理人设(请求, 响应) {
  const 体 = await 读请求体(请求)
  if (!体?.图片) return 返回json(响应, 400, { 错误: '缺少图片字段' })
  const 数据 = await 写人设({
    图片: 体.图片,
    类型: 体.类型 ?? 'image/jpeg',
    提示词: 体.提示词?.trim() || 人设提示词,
  })
  返回json(响应, 200, 数据)
}

// ---- 静态 ----

async function 托管静态(路径名, 响应) {
  let 相对 = 路径名
  if (相对 === '/' || 相对 === '') 相对 = '/索引.html'
  if (不对外.has(相对)) return 返回json(响应, 404, { 错误: '不提供这个文件' })
  const 目标 = normalize(join(页面目录, 相对))
  if (!目标.startsWith(normalize(页面目录))) return 返回json(响应, 403, { 错误: '越界了' })
  let 内容
  try {
    内容 = await readFile(目标)
  } catch {
    return 返回json(响应, 404, { 错误: `页面不存在：${相对}` })
  }
  响应.writeHead(200, {
    'content-type': 类型表[extname(目标).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  })
  响应.end(内容)
}

// ---- 路由 ----

const 路由表 = {
  '/api/状态': { 方法: 'GET', 处理: (请求, 响应) => 处理状态(响应) },
  '/api/设置': { 方法: 'POST', 处理: 处理设置 },
  '/api/测试': { 方法: 'POST', 处理: (请求, 响应) => 处理测试(响应) },
  '/api/生成': { 方法: 'POST', 处理: 处理生成 },
  '/api/人设': { 方法: 'POST', 处理: 处理人设 },
}

const 服务 = createServer(async (请求, 响应) => {
  const 开始 = Date.now()
  const 地址 = new URL(请求.url ?? '/', `http://${请求.headers.host ?? 'localhost'}`)
  let 路径
  try {
    // pathname 是百分号编码的，中文路由必须先解码再比
    路径 = decodeURIComponent(地址.pathname)
  } catch {
    return 返回json(响应, 400, { 错误: '路径编码不对' })
  }
  try {
    const 路由 = 路由表[路径]
    if (路由) {
      if (请求.method !== 路由.方法) {
        return 返回json(响应, 405, { 错误: `${路径} 只收 ${路由.方法}` })
      }
      return await 路由.处理(请求, 响应)
    }
    return await 托管静态(路径, 响应)
  } catch (错误) {
    const 文案 = 译错误(错误)
    console.error(`[立绘生成] ${路径} 失败：${文案}`)
    if (错误?.name === 'TimeoutError') {
      return 返回json(响应, 504, { 错误: '模型响应超时：可以调大 AI_TIMEOUT，或换更快的模型。' })
    }
    const 码 = Number(错误?.状态) || 500
    if (!响应.headersSent) 返回json(响应, 码, { 错误: 文案 })
    else 响应.end()
  } finally {
    console.log(`${请求.method} ${路径} ${响应.statusCode} ${Date.now() - 开始}ms`)
  }
})

服务.on('error', (错误) => {
  if (错误.code === 'EADDRINUSE') {
    console.error(`端口 ${端口} 被占了。换一个：$env:立绘端口="5175"; node 工具/立绘生成/服务端.mjs`)
  } else {
    console.error('[立绘生成] 启动失败：', 错误)
  }
  process.exit(1)
})

// 绑 :: （双栈）：只绑 127.0.0.1 的话，浏览器把 localhost 解析成 ::1 会连不上
服务.listen({ port: 端口, host: '::' }, async () => {
  const 配置 = await 读配置(true)
  console.log(`立绘生成 · http://localhost:${端口} 或 http://127.0.0.1:${端口}`)
  for (const 网卡 of Object.values(networkInterfaces()).flat()) {
    if (网卡 && 网卡.family === 'IPv4' && !网卡.internal) {
      console.log(`局域网 · http://${网卡.address}:${端口}（手机/另一台电脑）`)
    }
  }
  console.log(`提供方：${配置.提供方} · 图像 ${配置.图像模型} · 文本 ${配置.文本模型}`)
  console.log(
    配置.提供方 === '模拟'
      ? '模式：模拟（不联网，返回示例图）'
      : 配置.密钥
        ? '密钥：已配置'
        : '密钥：未配置 — 打开页面展开「模型设置」填一个，或设置 AI_KEY 后重启',
  )
})

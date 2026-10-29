// 页面逻辑：上传 → （可选）调模型 → 本地像素化 → 预览 / 下载。
// 所有像素运算都在 像素化.mjs 里，这里只管搬运和画布。

import { 处理, 分析全身, 抠背景 } from './像素化.mjs'
import { 生图提示词, 全身加强提示, 全身照片提示词, 像素立绘提示词 } from './提示词.mjs'

const $ = (选择器) => document.querySelector(选择器)

// 单文件版（直接双击 html）没有服务端：只跑本地像素化，示例图内嵌成 data URI。
const 离线 = window.__离线 === true
// 直连模式：没有服务端时，由浏览器自己调模型（key 存在当前浏览器的 localStorage）。
const 直连 = window.__直连 === true
const 示例地址 = 离线 && window.__示例图 ? window.__示例图 : './示例/示例照片.png'

const 原图画布 = $('#原图')
const 原图上下文 = 原图画布.getContext('2d')
const 结果画布 = $('#结果')
const 结果上下文 = 结果画布.getContext('2d')

// 原生尺寸的离屏画布：putImageData 之后按整数倍最近邻放大，下载也从这里出。
const 小画布 = document.createElement('canvas')
const 小上下文 = 小画布.getContext('2d')

let 源画布 = null
let 源图 = null
let 结果 = null
let 忙 = false
let 计时器 = 0

const 版本 = 'v0.5'

// 排查用：把关键步骤记下来，页面底部一点就能看到，不用开控制台
const 诊断 = []
function 记(事件, 细节 = '') {
  const 时 = new Date().toTimeString().slice(0, 8)
  诊断.push(`${时} ${事件}${细节 ? ' · ' + 细节 : ''}`)
  if (诊断.length > 60) 诊断.shift()
}

$('#诊断').addEventListener('click', () => {
  const 盒 = $('#诊断输出')
  盒.hidden = false
  盒.textContent = [
    `版本 ${版本} · 离线=${离线} · 直连=${直连}`,
    `UA ${navigator.userAgent}`,
    `状态 ${JSON.stringify(当前状态 ?? null).slice(0, 400)}`,
    `图片能力 createImageBitmap=${typeof createImageBitmap} Blob=${typeof Blob} URL.createObjectURL=${typeof URL?.createObjectURL}`,
    '---',
    ...诊断.slice(-40),
  ].join('\n')
})

$('#提示词').value = 生图提示词

function 提示(文字, 类别 = '') {
  const 元素 = $('#提示')
  元素.textContent = 文字
  元素.className = `提示 ${类别}`
}

function 读参数() {
  const [宽, 高] = $('#网格').value.split('x').map(Number)
  return {
    宽,
    高,
    颜色数: Number($('#颜色数').value),
    抖动: $('#抖动').checked,
    抠背景: $('#抠背景').checked,
    容差: Number($('#容差').value),
    自动裁剪: $('#自动裁剪').checked,
    对齐脚底: $('#对齐脚底').checked,
    缩放: Number($('#缩放').value) / 100,
    偏移X: Number($('#偏移X').value) / 100,
    偏移Y: Number($('#偏移Y').value) / 100,
    亮度: Number($('#亮度').value),
    对比度: Number($('#对比度').value),
    饱和度: Number($('#饱和度').value),
  }
}

function 重算() {
  if (!源图) return
  try {
    结果 = 处理(源图, 读参数())
  } catch (错误) {
    提示(`像素化失败：${错误.message}`, '坏')
    return
  }
  画原图()
  画结果()
  画色板()
  $('#尺寸').textContent = `${结果.宽} × ${结果.高}`
  $('#信息').textContent = `${结果.宽}×${结果.高} · ${结果.色板.length} 色 · 有效像素 ${结果.有效像素}`
  $('#下载').disabled = false
}

function 排重算() {
  clearTimeout(计时器)
  计时器 = setTimeout(重算, 70)
}

// 原图 + 取景框。框是源图坐标系里的，要换算回画布坐标。
function 画原图() {
  const W = 原图画布.width
  const H = 原图画布.height
  原图上下文.clearRect(0, 0, W, H)
  原图上下文.fillStyle = '#efe0bd'
  原图上下文.fillRect(0, 0, W, H)
  if (!源画布) return
  const 比 = Math.min(W / 源画布.width, H / 源画布.height)
  const w = 源画布.width * 比
  const h = 源画布.height * 比
  const ox = (W - w) / 2
  const oy = (H - h) / 2
  原图上下文.imageSmoothingEnabled = true
  原图上下文.drawImage(源画布, ox, oy, w, h)
  if (!结果) return

  const 框 = 结果.框
  const x = ox + 框.x * 比
  const y = oy + 框.y * 比
  const bw = 框.宽 * 比
  const bh = 框.高 * 比
  const 自动 = $('#自动裁剪').checked

  if (!自动) {
    原图上下文.save()
    原图上下文.fillStyle = 'rgba(36, 29, 43, 0.55)'
    原图上下文.beginPath()
    原图上下文.rect(ox, oy, w, h)
    原图上下文.rect(x, y, bw, bh)
    原图上下文.fill('evenodd')
    原图上下文.restore()
  }
  原图上下文.save()
  原图上下文.strokeStyle = 自动 ? 'rgba(255, 212, 122, 0.55)' : '#ffd47a'
  原图上下文.lineWidth = 2
  原图上下文.setLineDash(自动 ? [5, 5] : [])
  原图上下文.strokeRect(x + 1, y + 1, Math.max(1, bw - 2), Math.max(1, bh - 2))
  原图上下文.restore()
}

// 结果：先 putImageData 到原生尺寸，再用 drawImage 关掉平滑放大。
function 画结果() {
  if (!结果) return
  const 倍率 = Math.max(2, Math.min(12, Math.floor(360 / 结果.宽)))
  const 宽 = 结果.宽 * 倍率
  const 高 = 结果.高 * 倍率
  if (结果画布.width !== 宽 || 结果画布.height !== 高) {
    结果画布.width = 宽
    结果画布.height = 高
  }
  小画布.width = 结果.宽
  小画布.height = 结果.高
  小上下文.putImageData(new ImageData(结果.数据, 结果.宽, 结果.高), 0, 0)

  结果上下文.imageSmoothingEnabled = false
  结果上下文.clearRect(0, 0, 宽, 高)
  结果上下文.drawImage(小画布, 0, 0, 宽, 高)
}

function 画色板() {
  const 容器 = $('#色板')
  容器.textContent = ''
  if (!结果) return
  for (const [r, g, b] of 结果.色板) {
    const 十六 = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
    const 块 = document.createElement('button')
    块.type = 'button'
    块.className = '色块'
    块.style.background = 十六
    块.title = `${十六}（点一下复制）`
    块.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(十六)
        提示(`复制了 ${十六}`, '好')
      } catch {
        提示(十六)
      }
    })
    容器.append(块)
  }
}

async function 收文件(文件) {
  if (!文件) return
  if (!文件.type.startsWith('image/')) return 提示('要图片文件', '坏')
  try {
    const 位图 = await createImageBitmap(文件)
    装入(位图, 1280)
    $('#全身状态').textContent = ''
    $('#重试').hidden = true
    隐藏中间图()
    提示(`已载入 ${源图.宽}×${源图.高}`)
  } catch (错误) {
    提示(`读不了这张图：${错误.message}`, '坏')
  }
}

// 把任意位图装成「源画布 + 源像素」。上限 1280 是为了让每次拖滑条都即时。 
function 装入(位图, 上限) {
  const 比 = Math.min(1, 上限 / Math.max(位图.width, 位图.height))
  const w = Math.max(1, Math.round(位图.width * 比))
  const h = Math.max(1, Math.round(位图.height * 比))
  const 画布 = document.createElement('canvas')
  画布.width = w
  画布.height = h
  const 上下文 = 画布.getContext('2d', { willReadFrequently: true })
  上下文.drawImage(位图, 0, 0, w, h)
  源画布 = 画布
  源图 = { 数据: 上下文.getImageData(0, 0, w, h).data, 宽: w, 高: h }
  重算()
}

// ---- 直连模式 ----
// 没有服务端时，页面自己调服务商：key 只存在这台电脑的 localStorage，只发给你选的那一家。
// 这条路是为了「双击一个 html 就能生图」，代价是 key 在浏览器里（本机自用没问题，别公开部署）。

const 设置键 = '立绘生成-设置'

const 直连示例人设 = {
  名字: 'Elara',
  等级: 'Lv.1',
  职业: 'Cartographer',
  台词: 'Greetings, friend. The world holds countless wonders, don’t you think?',
  生日: { 季节: 'Spring', 日: 15 },
  性格: 'A quiet soul with a keen eye for ancient tales and hidden paths.',
  最爱的食物: 'Pumpkin Soup',
  喜欢: ['Ancient Books', 'Blueberries', 'Coffee'],
  讨厌: ['Mayonnaise', 'Soggy Newspaper', 'Seaweed'],
  宠物: { 名字: 'Onyx', 描述: 'A sleek black cat with piercing green eyes.' },
}

// 沙箱预览（iframe 没有 allow-same-origin）里碰 localStorage 会直接抛错，
// 所以这里做一层兜底：能存就存本地，不能存就只存内存，这次会话内照样能用。
const 内存存储 = new Map()
let 存储可用 = false
try {
  window.localStorage.setItem('__立绘探针', '1')
  window.localStorage.removeItem('__立绘探针')
  存储可用 = true
} catch {
  存储可用 = false
}

function 读存储(键) {
  if (存储可用) {
    try {
      return window.localStorage.getItem(键)
    } catch {
      存储可用 = false
    }
  }
  return 内存存储.has(键) ? 内存存储.get(键) : null
}

function 写存储(键, 值) {
  if (存储可用) {
    try {
      window.localStorage.setItem(键, 值)
      return
    } catch {
      存储可用 = false
    }
  }
  内存存储.set(键, 值)
}

function 本地设置() {
  try {
    return JSON.parse(读存储(设置键) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

function 存本地设置(部分) {
  const 新 = { ...本地设置() }
  if (部分?.清空密钥) delete 新.密钥
  for (const 键 of ['提供方', '密钥', '地址', '图像模型', '文本模型']) {
    if (typeof 部分?.[键] !== 'string') continue
    const 值 = 部分[键].trim()
    if (!值) continue
    新[键] = 值
  }
  写存储(设置键, JSON.stringify(新))
  return 新
}

function 主机名(地址) {
  try {
    return new URL(地址).host
  } catch {
    return 地址 || ''
  }
}

// 浏览器直连最容易卡在「没代理、一直转圈」。给 120 秒上限，超时说人话。
function 直连超时() {
  return typeof AbortSignal !== 'undefined' && AbortSignal.timeout
    ? AbortSignal.timeout(120_000)
    : undefined
}

function 译超时(错误) {
  if (错误?.name === 'TimeoutError' || /aborted|timeout/i.test(String(错误?.message ?? ''))) {
    return new Error(
      '请求超时（120 秒）：多半是网络或代理不通 —— 浏览器直连必须能访问该服务商，国内访问 Google 一般要开代理。',
    )
  }
  return 错误
}

function 本地状态() {
  const 设 = 本地设置()
  const 提供 = 设.提供方 || 'gemini'
  const 有密钥 = 提供 === '模拟' ? true : Boolean(设.密钥)
  return {
    提供方: 提供,
    提供方名称:
      提供 === 'ark'
        ? '火山方舟 · Seedream'
        : 提供 === 'openai'
          ? 'OpenAI 兼容'
          : 提供 === '模拟'
            ? '模拟（不联网）'
            : 'Google Gemini',
    提供方列表: [
      { 值: 'gemini', 名称: 'Google Gemini', 提示: '浏览器直连，走系统代理；key 只存本机' },
      { 值: 'ark', 名称: '火山方舟 · Seedream', 提示: '国内可直连；模型填 ep-... 接入点' },
      { 值: 'openai', 名称: 'OpenAI 兼容', 提示: '要填基址；浏览器直连可能被 CORS 拦' },
      { 值: '模拟', 名称: '模拟（不联网）', 提示: '不调模型，返回内置示例图' },
    ],
    有密钥,
    可生图: 有密钥,
    图像模型:
      设.图像模型 ||
      (提供 === 'openai'
        ? 'gpt-image-1'
        : 提供 === 'ark'
          ? 'doubao-seedream-4-0-250828'
          : 'gemini-3-pro-image-preview'),
    文本模型:
      设.文本模型 ||
      (提供 === 'openai'
        ? 'gpt-4o-mini'
        : 提供 === 'ark'
          ? 'doubao-1-5-pro-32k-250115'
          : 'gemini-3-flash-preview'),
    地址: 设.地址 ? 主机名(设.地址) : '',
    模拟: 提供 === '模拟',
  }
}

function 译直连错误(状态码, 原文) {
  const 尾 = String(原文 ?? '').replace(/\s+/g, ' ').slice(0, 240)
  if (状态码 === 400) return `请求被拒（400）：模型可能不支持图片输入或参数不对。${尾}`
  if (状态码 === 401 || 状态码 === 403) return `key 无效或没权限（${状态码}）：${尾}`
  if (状态码 === 404) return `模型/接口不存在（404）：模型名写错了？${尾}`
  if (状态码 === 429) return `配额或频率限制（429）：等一会儿或换 key。${尾}`
  return `上游 ${状态码}：${尾}`
}

async function 直连Gemini(内容, 生成配置, 模型) {
  const 设 = 本地设置()
  if (!设.密钥) throw new Error('还没填 key：展开「模型设置」粘贴后点保存。')
  const 址 = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(模型)}:generateContent?key=${encodeURIComponent(设.密钥)}`
  const 响应 = await fetch(址, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: 内容 }], generationConfig: 生成配置 }),
    signal: 直连超时(),
  })
  const 文 = await 响应.text()
  if (!响应.ok) throw new Error(译直连错误(响应.status, 文))
  return JSON.parse(文)
}

function 转base64(块) {
  return new Promise((好, 坏) => {
    const 读 = new FileReader()
    读.onload = () => 好(String(读.result).split(',')[1])
    读.onerror = () => 坏(new Error('读取图片失败'))
    读.readAsDataURL(块)
  })
}

async function 直连生图(体) {
  const 设 = 本地设置()
  const 提供 = 设.提供方 || 'gemini'
  const 提示词 = 体.提示词?.trim() || 生图提示词
  if (提供 === '模拟') {
    const 内置 = window.__示例图
    if (!内置) throw new Error('单文件版缺少内置示例图')
    return { 图片: 内置.split(',')[1], 类型: 'image/png', 说明: '模拟提供方：这是内置示例图，不是你的照片。' }
  }
  if (!设.密钥) throw new Error('还没填 key：展开「模型设置」粘贴后点保存。')

  if (提供 === 'ark') {
    const 基 = (设.地址 || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '')
    const 尺寸 = 体.比例 === '2:3' ? '1365x2048' : 体.比例 === '3:4' ? '1536x2048' : '2048x2048'
    const 响应 = await fetch(`${基}/images/generations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${设.密钥}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 设.图像模型 || 'doubao-seedream-4-0-250828',
        prompt: 提示词,
        image: `data:${体.类型 || 'image/jpeg'};base64,${体.图片}`,
        size: 尺寸,
        response_format: 'b64_json',
        watermark: false,
      }),
      signal: 直连超时(),
    })
    const 文 = await 响应.text()
    if (!响应.ok) throw new Error(译直连错误(响应.status, 文))
    const 数据 = JSON.parse(文)
    const 首张 = 数据?.data?.[0]
    if (首张?.b64_json) return { 图片: 首张.b64_json, 类型: 'image/png', 说明: '' }
    if (首张?.url) {
      const 图响应 = await fetch(首张.url)
      if (!图响应.ok) throw new Error(`下载结果图失败：${图响应.status}`)
      return { 图片: await 转base64(await 图响应.blob()), 类型: 'image/png', 说明: '' }
    }
    throw new Error(`方舟没返回图片：${文.slice(0, 200)}`)
  }

  if (提供 === 'openai') {
    const 基 = (设.地址 || 'https://api.openai.com/v1').replace(/\/+$/, '')
    const 二进制 = await (await fetch(`data:${体.类型 || 'image/png'};base64,${体.图片}`)).blob()
    const 表单 = new FormData()
    表单.append('model', 设.图像模型 || 'gpt-image-1')
    表单.append('prompt', 提示词)
    表单.append('size', 体.比例 === '2:3' || 体.比例 === '3:4' ? '1024x1536' : '1024x1024')
    表单.append('image', 二进制, 'input.png')
    const 响应 = await fetch(`${基}/images/edits`, {
      method: 'POST',
      headers: { authorization: `Bearer ${设.密钥}` },
      body: 表单,
      signal: 直连超时(),
    })
    const 文 = await 响应.text()
    if (!响应.ok) throw new Error(译直连错误(响应.status, 文))
    const 数据 = JSON.parse(文)
    const 首张 = 数据?.data?.[0]
    if (首张?.b64_json) return { 图片: 首张.b64_json, 类型: 'image/png', 说明: 首张.revised_prompt ?? '' }
    if (首张?.url) {
      const 图响应 = await fetch(首张.url)
      if (!图响应.ok) throw new Error(`下载结果图失败：${图响应.status}`)
      return { 图片: await 转base64(await 图响应.blob()), 类型: 'image/png', 说明: '' }
    }
    throw new Error('图片服务没返回图片（既没有 b64_json 也没有 url）')
  }

  const 模型 = 设.图像模型 || 'gemini-3-pro-image-preview'
  const 数据 = await 直连Gemini(
    [
      { inline_data: { mime_type: 体.类型 || 'image/jpeg', data: 体.图片 } },
      { text: 提示词 },
    ],
    { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: 体.比例 || '3:4', imageSize: '1K' } },
    模型,
  )
  const 片段 = 数据?.candidates?.[0]?.content?.parts ?? []
  const 图 = 片段.find((项) => 项?.inlineData?.data ?? 项?.inline_data?.data)
  const 文字 = 片段
    .map((项) => 项?.text)
    .filter(Boolean)
    .join('\n')
  if (!图) throw new Error(`模型只回了文字，没给图：${(文字 || '（空）').slice(0, 200)}`)
  const 内容 = 图.inlineData ?? 图.inline_data
  return { 图片: 内容.data, 类型: 内容.mimeType ?? 内容.mime_type ?? 'image/png', 说明: 文字 }
}

async function 直连人设(体) {
  const 设 = 本地设置()
  const 提供 = 设.提供方 || 'gemini'
  const 提示词 = 体.提示词?.trim() || 人设提示词
  if (提供 === '模拟') return 直连示例人设
  if (!设.密钥) throw new Error('还没填 key：展开「模型设置」粘贴后点保存。')

  let 文字 = ''
  if (提供 === 'openai' || 提供 === 'ark') {
    const 兜底基址 =
      提供 === 'ark' ? 'https://ark.cn-beijing.volces.com/api/v3' : 'https://api.openai.com/v1'
    const 基 = (设.地址 || 兜底基址).replace(/\/+$/, '')
    const 响应 = await fetch(`${基}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${设.密钥}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 设.文本模型 || (提供 === 'ark' ? 'doubao-1-5-pro-32k-250115' : 'gpt-4o-mini'),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 提示词 },
              { type: 'image_url', image_url: { url: `data:${体.类型 || 'image/jpeg'};base64,${体.图片}` } },
            ],
          },
        ],
      }),
      signal: 直连超时(),
    })
    const 原文 = await 响应.text()
    if (!响应.ok) throw new Error(译直连错误(响应.status, 原文))
    文字 = JSON.parse(原文)?.choices?.[0]?.message?.content ?? ''
  } else {
    const 数据 = await 直连Gemini(
      [
        { inline_data: { mime_type: 体.类型 || 'image/jpeg', data: 体.图片 } },
        { text: 提示词 },
      ],
      { responseMimeType: 'application/json', temperature: 0.9 },
      设.文本模型 || 'gemini-3-flash-preview',
    )
    文字 = (数据?.candidates?.[0]?.content?.parts ?? [])
      .map((项) => 项?.text)
      .filter(Boolean)
      .join('')
  }
  const 干净 = String(文字).replace(/```(?:json)?/gi, '').trim()
  const 起 = 干净.indexOf('{')
  const 止 = 干净.lastIndexOf('}')
  if (起 < 0 || 止 <= 起) throw new Error(`人设不是 JSON：${干净.slice(0, 160)}`)
  return JSON.parse(干净.slice(起, 止 + 1))
}

async function 直连测试() {
  const 设 = 本地设置()
  const 提供 = 设.提供方 || 'gemini'
  if (提供 === '模拟') return { 成功: true, 说明: '模拟提供方，不需要联网。', 候选模型: [] }
  if (!设.密钥) return { 成功: false, 说明: '还没填 key。', 候选模型: [] }
  try {
    if (提供 === 'ark') {
      const 基 = (设.地址 || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '')
      const 响应 = await fetch(`${基}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${设.密钥}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 设.文本模型 || 'doubao-1-5-pro-32k-250115',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: 直连超时(),
      })
      const 原文 = await 响应.text()
      if (!响应.ok) return { 成功: false, 说明: 译直连错误(响应.status, 原文), 候选模型: [] }
      return {
        成功: true,
        说明: `连上火山方舟，key 有效。确认「图像模型」是已开通的 Seedream 接入点（${设.图像模型 || '未填'}）。`,
        候选模型: [],
      }
    }
    if (提供 === 'openai') {
      const 基 = (设.地址 || 'https://api.openai.com/v1').replace(/\/+$/, '')
      const 响应 = await fetch(`${基}/models`, {
        headers: { authorization: `Bearer ${设.密钥}` },
        signal: 直连超时(),
      })
      const 原文 = await 响应.text()
      if (!响应.ok) return { 成功: false, 说明: 译直连错误(响应.status, 原文), 候选模型: [] }
      const 名字们 = (JSON.parse(原文)?.data ?? []).map((项) => 项.id).filter(Boolean)
      return { 成功: true, 说明: `连上了 ${主机名(基)}，模型 ${名字们.length} 个。`, 候选模型: 名字们.slice(0, 40) }
    }
    const 响应 = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(设.密钥)}&pageSize=200`,
      { signal: 直连超时() },
    )
    const 原文 = await 响应.text()
    if (!响应.ok) return { 成功: false, 说明: 译直连错误(响应.status, 原文), 候选模型: [] }
    const 全部 = (JSON.parse(原文)?.models ?? []).map((项) => String(项.name ?? '').replace(/^models\//, ''))
    const 图像 = 全部.filter((名) => /image/i.test(名))
    return {
      成功: true,
      说明: 图像.length
        ? `key 有效，可用图像模型 ${图像.length} 个，例如 ${图像.slice(0, 3).join('、')}。`
        : 'key 有效，但没看到 image 模型。',
      候选模型: 图像.slice(0, 40),
    }
  } catch (错误) {
    return {
      成功: false,
      说明: `浏览器直连失败：${错误.message}（可能是 CORS、网络或代理问题）`,
      候选模型: [],
    }
  }
}

// 统一入口：有服务端走服务端，没服务端就在浏览器里直连。
async function 调接口(路径, 体) {
  if (!直连) {
    const 参数 =
      体 === undefined
        ? {}
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(体) }
    const 回 = await fetch(路径, 参数)
    const 数据 = await 回.json().catch(() => ({ 错误: `服务端返回了非 JSON（${回.status}）` }))
    if (!回.ok) throw new Error(数据.错误 || `请求失败（${回.status}）`)
    return 数据
  }
  try {
    if (路径 === '/api/状态') return 本地状态()
    if (路径 === '/api/设置') {
      存本地设置(体)
      return {
        ...本地状态(),
        已写入: 存储可用 ? '当前浏览器的 localStorage' : '本次会话内存（此环境禁用存储）',
        提醒: 存储可用 ? 'key 只保存在这台电脑的浏览器里。' : '这个预览环境禁用了存储，关闭页面后 key 需要重填。',
      }
    }
    if (路径 === '/api/测试') return 直连测试()
    if (路径 === '/api/生成') return 直连生图(体)
    if (路径 === '/api/人设') return 直连人设(体)
    throw new Error(`未知接口 ${路径}`)
  } catch (错误) {
    throw 译超时(错误)
  }
}

async function 取状态() {
  if (离线 && !直连) return null
  try {
    return await 调接口('/api/状态')
  } catch {
    return null
  }
}

let 当前状态 = null

function 设置提示(文字, 类别 = '') {
  const 元素 = $('#设置提示')
  元素.textContent = 文字
  元素.className = `提示 ${类别}`
}

function 应用状态(状态, 回填 = false) {
  if (离线 && !直连) {
    $('#状态').textContent = '单文件版 · 无需服务端'
    $('#状态').className = '徽标 好'
    $('#生成').disabled = true
    $('#人设').disabled = true
    $('#生成').textContent = '① AI 生成（需服务端版）'
    $('#人设').textContent = '② 人设卡（需服务端版）'
    $('#设置区').hidden = true
    提示('单文件版：本地像素化全部可用。点「载入示例照片」直接看效果，或上传你自己的照片。', '')
    return
  }
  if (!状态) {
    $('#状态').textContent = '服务端没响应'
    $('#状态').className = '徽标 差'
    提示('连不上服务端：确认 node 工具/立绘生成/服务端.mjs 还在跑，然后刷新页面。', '坏')
    return
  }
  当前状态 = 状态
  const 徽标 = $('#状态')
  const 前缀 = 直连 ? '直连 · ' : ''
  徽标.textContent = 前缀 + (状态.模拟
    ? '模拟提供方 · 返回示例图'
    : 状态.有密钥
      ? `${状态.提供方名称} · ${状态.图像模型}`
      : '未配密钥 · 只能本地像素化')
  徽标.className = '徽标 ' + (状态.有密钥 ? (状态.模拟 ? '' : '好') : '差')
  if (直连) {
    提示(
      存储可用
        ? '直连模式：key 只保存在这台电脑的浏览器里（localStorage），只发给你选的那家服务商。'
        : '这个页面被放在沙箱里预览（禁用了 localStorage）：能用，但 key 只在本次会话有效。建议直接用资源管理器双击打开这个 html。',
      存储可用 ? '' : '坏',
    )
    // 浏览器直连走的是系统代理，页面里的代理栏用不上，藏起来免得误解
    document.querySelector('#直连步骤').hidden = Boolean(状态.有密钥)
    const 代理行 = document.querySelector('#代理')?.closest('label')
    if (代理行) 代理行.hidden = true
  }
  if (直连 && !状态.有密钥) {
    $('#设置区').open = true
    设置提示('把 key 粘到上面「密钥」框里，点「保存并测试」。只想看流程就先把提供方切成「模拟」。', '')
  }

  const 选择 = $('#提供方')
  if (选择.options.length === 0) {
    for (const 项 of 状态.提供方列表 ?? []) {
      const 选项 = document.createElement('option')
      选项.value = 项.值
      选项.textContent = 项.名称
      选项.title = 项.提示 ?? ''
      选择.append(选项)
    }
  }
  if (!回填) return
  选择.value = 状态.提供方
  $('#图像模型').value = 状态.图像模型 ?? ''
  $('#文本模型').value = 状态.文本模型 ?? ''
  $('#代理').placeholder = 状态.代理
    ? `当前：${状态.代理}（改了才需要填）`
    : '例如 http://127.0.0.1:7890（Clash 默认端口）；国内用 Gemini 必填'
  $('#地址').placeholder = 状态.地址
    ? `当前：${状态.地址}（改了才需要填）`
    : '仅「OpenAI 兼容」需要，例如 https://api.openai.com/v1'
}

async function 刷新状态(回填 = false) {
  const 状态 = await 取状态()
  应用状态(状态, 回填)
  return 状态
}

// 既能加载同目录文件，也能加载内嵌的 data URI（单文件版用）。
function 载图(网址) {
  return new Promise((成功, 失败) => {
    const 图 = new Image()
    图.onload = () => 成功(图)
    图.onerror = () => 失败(new Error('图片加载失败'))
    图.src = 网址
  })
}

function 从数据网址(数据, 类型) {
  return new Promise((成功, 失败) => {
    let 址
    try {
      址 = 数据转网址({ 图片: 数据, 类型 }, 类型)
    } catch (错误) {
      失败(错误)
      return
    }
    const 图 = new Image()
    图.onload = () => {
      URL.revokeObjectURL(址)
      成功(图)
    }
    图.onerror = () => {
      URL.revokeObjectURL(址)
      失败(new Error(`图片解不开（类型 ${类型 || '未知'}，base64 ${Math.round((数据?.length ?? 0) / 1024)} KB）`))
    }
    图.src = 址
  })
}

// 第一段产出的写实全身照；「只重做第二步」要用它当输入。
let 第一步结果 = null
// 上一次点生成时用的自拍，供「只重做第一步」复用
let 上次自拍 = null

async function 生成(加强 = false) {
  if (忙) return
  if (离线 && !直连) return 提示('单文件版没有服务端，AI 功能用不了。要调模型：node 工具/立绘生成/服务端.mjs', '坏')
  if (!源画布) return 提示('先上传一张照片', '坏')
  const 状态 = 当前状态 ?? (await 刷新状态())
  if (!状态?.可生图) {
    return 提示('还没配好模型：展开「模型设置」填 key 并保存；不想联网就先把提供方切成「模拟」。', '坏')
  }
  const 两段 = $('#两段式').checked
  忙 = true
  const 按钮 = $('#生成')
  按钮.disabled = true
  按钮.textContent = 两段 ? '两段式生成中…' : '生成中…'
  $('#重试').hidden = true
  $('#第一步操作').hidden = true
  try {
    上次自拍 = 源画布.toDataURL('image/jpeg', 0.92).split(',')[1]
    if (两段) {
      第一步结果 = null
      const 结 = await 跑第一步(加强, 状态)
      if (!结.通过) {
        // 卡在第一步就不再往下走 —— 第二段只会把一张半身照忠实地像素化
        $('#第一步操作').hidden = false
        提示(`第 1 步没通过：${结.校验.说明}。可以「只重做第一步」，或者「用这张继续」硬着头皮往下走。`, '坏')
        return
      }
      await 跑第二步(加强)
    } else {
      提示(`正在调 ${状态.图像模型}，通常 10~40 秒…`)
      const 基础 = $('#提示词').value.trim() || 生图提示词
      const 数据 = await 调接口('/api/生成', {
        图片: 上次自拍,
        类型: 'image/jpeg',
        提示词: 加强 ? `${基础}\n\n${全身加强提示}` : 基础,
        阶段: '像素',
        比例: '3:4',
      })
      隐藏中间图()
      await 装入结果(数据)
    }
  } catch (错误) {
    提示(错误.message, '坏')
    记('生成失败', 错误.message)
    // 两段式里第 1 步就挂了也留一个重试入口，别让页面卡死
    if (两段 && 上次自拍) {
      $('#第一步操作').hidden = false
      const 盒 = $('#第一步状态')
      盒.textContent = `第 1 步出错：${错误.message}`
      盒.className = '小字 警示'
    }
  } finally {
    忙 = false
    按钮.disabled = false
    按钮.textContent = '① AI 生成像素立绘'
  }
}

// ---- 第 1 步：自拍 → 写实全身照 ----

async function 跑第一步(加强, 状态 = 当前状态) {
  提示(`第 1/2 步：生成写实全身照（${状态?.图像模型 ?? '模型'}）…`)
  记('第1步请求', `加强=${加强}`)
  let 数据 = await 调接口('/api/生成', {
    图片: 上次自拍,
    类型: 'image/jpeg',
    提示词: 加强 ? `${全身照片提示词}\n\n${全身加强提示}` : 全身照片提示词,
    阶段: '全身',
    比例: '2:3',
  })
  记('第1步返回', `类型=${数据?.类型} base64=${Math.round((数据?.图片?.length ?? 0) / 1024)}KB`)
  if (!数据?.图片) {
    throw new Error(`第 1 步没拿到图片，服务端返回的是：${JSON.stringify(数据).slice(0, 160)}`)
  }
  let 校验 = await 校验全身照(数据)
  记('第1步校验', 校验.说明)

  // 自动补救一次：模型很爱交半身，第一次不过就带加强提示再来一张
  if (!校验.是全身 && !加强) {
    提示('第 1 步的构图不像全身，自动带加强提示重试一次…')
    记('第1步自动重试')
    数据 = await 调接口('/api/生成', {
      图片: 上次自拍,
      类型: 'image/jpeg',
      提示词: `${全身照片提示词}\n\n${全身加强提示}`,
      阶段: '全身',
      比例: '2:3',
    })
    记('第1步重试返回', `类型=${数据?.类型} base64=${Math.round((数据?.图片?.length ?? 0) / 1024)}KB`)
    if (!数据?.图片) {
      throw new Error(`第 1 步重试也没拿到图片：${JSON.stringify(数据).slice(0, 160)}`)
    }
    校验 = await 校验全身照(数据)
    记('第1步重试校验', 校验.说明)
  }

  第一步结果 = 数据
  显示中间图(数据)
  显示第一步状态(校验)
  return { 数据, 校验, 通过: 校验.是全身 }
}

// 把中间产物转成像素数据来量「是不是全身」。
// 容差试三档：棚拍底有时带一点渐变，固定 36 抠不干净会把「脚下那片背景」算成身体，
// 半身和全身就分不出来了 —— 所以只要任意一档能判成全身就算过。
async function 校验全身照(数据) {
  const 图 = await 从数据网址(数据.图片, 数据.类型)
  const 比 = Math.min(1, 900 / Math.max(图.width, 图.height))
  const 画布 = document.createElement('canvas')
  画布.width = Math.max(1, Math.round(图.width * 比))
  画布.height = Math.max(1, Math.round(图.height * 比))
  const 上下文 = 画布.getContext('2d', { willReadFrequently: true })
  上下文.drawImage(图, 0, 0, 画布.width, 画布.height)
  const 源 = { 数据: 上下文.getImageData(0, 0, 画布.width, 画布.height).data, 宽: 画布.width, 高: 画布.height }

  let 兜底 = null
  for (const 容差 of [36, 70, 110]) {
    const 抠 = 抠背景(源, 容差)
    const 结 = 分析全身(抠.图)
    const 抠得合理 = 抠.抠除比例 > 0.1 && 抠.抠除比例 < 0.97
    if (结.是全身) {
      记('校验全身照', `容差 ${容差} 判全身（抠除 ${(抠.抠除比例 * 100).toFixed(0)}%）`)
      return 结
    }
    if (!兜底 || (抠得合理 && !兜底.抠得合理)) 兜底 = { ...结, 抠得合理 }
  }
  return 兜底 ?? 分析全身(源)
}

function 显示第一步状态(校验) {
  const 盒 = $('#第一步状态')
  盒.textContent = `第 1 步校验：${校验.说明}`
  盒.className = `小字 ${校验.是全身 ? '好' : '警示'}`
}

// ---- 第 2 步：全身照 → 像素立绘 ----

async function 跑第二步(加强) {
  if (!第一步结果) throw new Error('还没有全身照，先跑第 1 步')
  提示('第 2/2 步：把全身照转成星露谷像素立绘…')
  const 像素 = await 调接口('/api/生成', {
    图片: 第一步结果.图片,
    类型: 第一步结果.类型,
    提示词: 加强 ? `${像素立绘提示词}\n\n${全身加强提示}` : 像素立绘提示词,
    阶段: '像素',
    比例: '3:4',
  })
  记('第2步返回', `类型=${像素?.类型} base64=${Math.round((像素?.图片?.length ?? 0) / 1024)}KB`)
  await 装入结果(像素, true)
}

async function 装入结果(数据, 两段 = false) {
  const 位图 = await 从数据网址(数据.图片, 数据.类型)
  $('#抠背景').checked = true
  $('#自动裁剪').checked = true
  装入(位图, 1600)
  const 结 = 全身校验()
  提示(
    结?.是全身
      ? `${两段 ? '两段式完成' : '生成好了'}：全身构图通过，已抠背景、脚底对齐`
      : '生成好了，但构图不像全身 —— 点下面的「重试」会带上加强提示再生成一次',
    结?.是全身 ? '好' : '坏',
  )
}

// base64 → Blob URL。比直接拼 data: URI 稳：几 MB 的图不会因为 URL 解析出问题，
// 也能直接挂到 <a download> 上。
function 数据转网址(数据, 类型) {
  if (!数据?.图片) throw new Error('返回里没有图片数据（图片字段是空的）')
  const 二进制 = atob(数据.图片)
  const 字节 = new Uint8Array(二进制.length)
  for (let i = 0; i < 二进制.length; i++) 字节[i] = 二进制.charCodeAt(i)
  return URL.createObjectURL(new Blob([字节], { type: 数据.类型 || 类型 || 'image/png' }))
}

function 显示中间图(数据) {
  const 盒 = $('#第一步状态')
  const 图 = $('#中间图img')
  let 址
  try {
    址 = 数据转网址(数据)
  } catch (错误) {
    盒.textContent = `第 1 步失败：${错误.message}`
    盒.className = '小字 警示'
    return
  }
  图.onerror = () => {
    盒.textContent = `第 1 步的图打不开（类型 ${数据.类型 || '未知'}，base64 ${Math.round((数据.图片?.length ?? 0) / 1024)} KB）`
    盒.className = '小字 警示'
  }
  图.src = 址
  const 链 = $('#下载全身')
  链.href = 址
  链.download = '全身照.png'
  $('#中间图').hidden = false
}

function 隐藏中间图() {
  $('#中间图').hidden = true
  const 图 = $('#中间图img')
  if (图.src.startsWith('blob:')) URL.revokeObjectURL(图.src)
  图.removeAttribute('src')
  $('#第一步状态').textContent = ''
  $('#第一步操作').hidden = true
  第一步结果 = null
}

// 统一处理「按钮进入忙碌态 → 干活 → 恢复」，省得每个按钮抄一遍
async function 执行(按钮, 文字, 工作) {
  if (忙) return
  忙 = true
  const 原文 = 按钮.textContent
  按钮.disabled = true
  按钮.textContent = 文字
  $('#第一步操作').hidden = true
  try {
    await 工作()
  } catch (错误) {
    提示(错误.message, '坏')
    记('操作失败', 错误.message)
  } finally {
    忙 = false
    按钮.disabled = false
    按钮.textContent = 原文
  }
}

// 全身校验：拿当前参数抠一遍背景，量一下主体是不是「头顶到脚底」的完整人形。
function 全身校验() {
  const 盒 = $('#全身状态')
  const 重试 = $('#重试')
  if (!源图) return null
  const p = 读参数()
  const 图 = p.抠背景 ? 抠背景(源图, p.容差).图 : 源图
  const 结 = 分析全身(图)
  盒.textContent = `全身校验：${结.说明}`
  盒.className = `小字 ${结.是全身 ? '好' : '警示'}`
  重试.hidden = 结.是全身
  return 结
}

function 转义(值) {
  return String(值 ?? '').replace(/[&<>"]/g, (字符) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[字符])
}

function 渲染人设(数据) {
  const 卡 = $('#人设卡')
  卡.hidden = false
  卡.innerHTML = `
    <h3>${转义(数据.名字) || '未命名'} · ${转义(数据.等级)}${数据.职业 ? ' · ' + 转义(数据.职业) : ''}</h3>
    <p>“${转义(数据.台词)}”</p>
    <p><i>生日</i> ${转义(数据.生日?.季节)} ${转义(数据.生日?.日)}</p>
    <p><i>性格</i> ${转义(数据.性格)}</p>
    <p><i>最爱</i> ${转义(数据.最爱的食物)}</p>
    <p><i>喜欢</i> ${(数据.喜欢 ?? []).map(转义).join('、')}</p>
    <p><i>讨厌</i> ${(数据.讨厌 ?? []).map(转义).join('、')}</p>
    <p><i>宠物</i> ${转义(数据.宠物?.名字)} —— ${转义(数据.宠物?.描述)}</p>`
}

async function 生成人设() {
  if (忙) return
  if (离线 && !直连) return 提示('单文件版没有服务端，人设卡用不了', '坏')
  if (!源画布) return 提示('先上传一张照片', '坏')
  const 状态 = 当前状态 ?? (await 刷新状态())
  if (!状态?.可生图) return 提示('还没配好模型：先去「模型设置」填 key 并保存。', '坏')
  忙 = true
  const 按钮 = $('#人设')
  按钮.disabled = true
  按钮.textContent = '写人设…'
  提示(`正在调 ${状态.文本模型} 写人设…`)
  try {
    const 图 = 源画布.toDataURL('image/jpeg', 0.92).split(',')[1]
    const 数据 = await 调接口('/api/人设', { 图片: 图, 类型: 'image/jpeg' })
    渲染人设(数据)
    提示('人设卡写好了', '好')
  } catch (错误) {
    提示(错误.message, '坏')
  } finally {
    忙 = false
    按钮.disabled = false
    按钮.textContent = '② 生成人设卡'
  }
}

// ---- 事件 ----

$('#落区').addEventListener('click', () => $('#文件').click())
$('#落区').addEventListener('keydown', (事件) => {
  if (事件.key === 'Enter' || 事件.key === ' ') $('#文件').click()
})
$('#文件').addEventListener('change', (事件) => 收文件(事件.target.files?.[0]))

const 落区 = $('#落区')
for (const 名 of ['dragenter', 'dragover']) {
  落区.addEventListener(名, (事件) => {
    事件.preventDefault()
    落区.classList.add('悬停')
  })
}
for (const 名 of ['dragleave', 'drop']) {
  落区.addEventListener(名, (事件) => {
    事件.preventDefault()
    落区.classList.remove('悬停')
  })
}
落区.addEventListener('drop', (事件) => 收文件(事件.dataTransfer?.files?.[0]))

for (const 控件 of document.querySelectorAll('.参数 input, .参数 select')) {
  控件.addEventListener('input', () => {
    同步输出()
    排重算()
  })
}

// 自动裁剪开着的时候，缩放/偏移没意义，置灰避免误解。
$('#自动裁剪').addEventListener('change', (事件) => {
  const 关掉 = 事件.target.checked
  for (const id of ['#缩放', '#偏移X', '#偏移Y']) $(id).disabled = 关掉
  $('#抠背景').disabled = false
  排重算()
})

$('#抠背景').addEventListener('change', () => {
  $('#容差').disabled = !$('#抠背景').checked
  排重算()
})

function 同步输出() {
  for (const 控件 of document.querySelectorAll('.参数 input[type="range"]')) {
    const 输出 = document.querySelector(`#${控件.id}值`)
    if (!输出) continue
    输出.textContent = 控件.id === '缩放' ? `${控件.value}%` : 控件.id.startsWith('偏移') ? `${控件.value}` : 控件.value
  }
}

$('#生成').addEventListener('click', () => 生成(false))
$('#重试').addEventListener('click', () => {
  // 已经有全身照就只重做第二步，别再烧一次第一步
  if (第一步结果) 执行($('#重试'), '重做第二步…', () => 跑第二步(true))
  else 生成(true)
})
$('#只重做第一步').addEventListener('click', (事件) => {
  if (!上次自拍) return 提示('先点一次「① AI 生成像素立绘」，有了自拍才能重做第 1 步', '坏')
  执行(事件.currentTarget, '重做第 1 步…', async () => {
    const 结 = await 跑第一步(true)
    if (结.通过) {
      $('#第一步操作').hidden = true
      await 跑第二步(true)
    } else {
      $('#第一步操作').hidden = false
      提示(`第 1 步还是不像全身：${结.校验.说明}`, '坏')
    }
  })
})
$('#继续第二步').addEventListener('click', (事件) =>
  执行(事件.currentTarget, '第 2 步…', async () => {
    await 跑第二步(true)
  }),
)
$('#人设').addEventListener('click', 生成人设)

// 只跑第 1 步：方便单独调「自拍 → 写实全身照」这一段，不用每次都为第 2 步付钱
$('#只跑第一步').addEventListener('click', (事件) => {
  if (!源画布) return 提示('先上传一张照片', '坏')
  执行(事件.currentTarget, '跑第 1 步…', async () => {
    上次自拍 = 源画布.toDataURL('image/jpeg', 0.92).split(',')[1]
    第一步结果 = null
    隐藏中间图()
    const 状态 = 当前状态 ?? (await 刷新状态())
    if (!状态?.可生图) {
      提示('还没配好模型：展开「模型设置」填 key 并保存，或先点「保存并测试」。', '坏')
      return
    }
    const 结 = await 跑第一步(false, 状态)
    $('#第一步操作').hidden = false
    提示(
      结.通过
        ? '第 1 步通过：想要像素立绘就点「用这张全身照继续」；不满意就「只重做第一步」'
        : `第 1 步没通过：${结.校验.说明}。点「只重做第一步」会带加强提示再来一次`,
      结.通过 ? '好' : '坏',
    )
  })
})

// 示例图是合成的占位头像（不是真人照片），只为让你不传图也能看到整条管线。
$('#示例').addEventListener('click', async () => {
  try {
    const 位图 = await 载图(示例地址)
    $('#抠背景').checked = true
    $('#自动裁剪').checked = true
    装入(位图, 1280)
    全身校验()
    隐藏中间图()
    提示('已载入示例照片：背景是纯色，所以抠得很干净。换成你自己的照片试试。', '好')
  } catch (错误) {
    提示(`载入示例失败：${错误.message}`, '坏')
  }
})

$('#下载').addEventListener('click', () => {
  if (!结果) return
  小画布.toBlob((块) => {
    if (!块) return 提示('导出失败', '坏')
    const 链接 = document.createElement('a')
    链接.href = URL.createObjectURL(块)
    链接.download = `立绘_${结果.宽}x${结果.高}.png`
    链接.click()
    setTimeout(() => URL.revokeObjectURL(链接.href), 2000)
    提示(`已导出 ${结果.宽}×${结果.高} PNG`, '好')
  }, 'image/png')
})

// ---- 模型设置 ----

async function 保存设置() {
  const 按钮 = $('#保存设置')
  按钮.disabled = true
  设置提示('正在保存…')
  try {
    const 体 = {
      提供方: $('#提供方').value,
      密钥: $('#密钥').value,
      地址: $('#地址').value,
      代理: $('#代理').value,
      图像模型: $('#图像模型').value,
      文本模型: $('#文本模型').value,
    }
    const 数据 = await 调接口('/api/设置', 体)
    $('#密钥').value = ''
    应用状态(数据, true)
    设置提示(数据.提醒 || (数据.已写入 ? `已保存到${数据.已写入}` : '已保存'), '好')
    await 测试连接()
  } catch (错误) {
    设置提示(错误.message, '坏')
  } finally {
    按钮.disabled = false
  }
}

async function 测试连接() {
  const 按钮 = $('#测试')
  按钮.disabled = true
  设置提示('正在测试连接…')
  const 候选 = $('#候选模型')
  候选.textContent = ''
  try {
    const 数据 = await 调接口('/api/测试', {})
    设置提示(数据.说明, 数据.成功 ? '好' : '坏')
    for (const 名 of 数据.候选模型 ?? []) {
      const 块 = document.createElement('button')
      块.type = 'button'
      块.textContent = 名
      块.title = '点一下填进「图像模型」'
      块.addEventListener('click', () => {
        $('#图像模型').value = 名
        设置提示(`已填入 ${名}，记得点「保存并测试」`)
      })
      候选.append(块)
    }
  } catch (错误) {
    设置提示(错误.message, '坏')
  } finally {
    按钮.disabled = false
  }
}

$('#保存设置').addEventListener('click', 保存设置)
$('#测试').addEventListener('click', 测试连接)
$('#清除密钥').addEventListener('click', async () => {
  try {
    const 数据 = await 调接口('/api/设置', { 清空密钥: true })
    $('#密钥').value = ''
    应用状态(数据, true)
    设置提示('已清除保存的 key', '好')
  } catch (错误) {
    设置提示(错误.message, '坏')
  }
})
// 切提供方时把模型名一起换掉 —— 否则很容易拿着 Gemini 的 key 去调方舟的模型名
const 模型默认 = {
  gemini: { 图像模型: 'gemini-3-pro-image-preview', 文本模型: 'gemini-3-flash-preview' },
  ark: { 图像模型: 'doubao-seedream-4-0-250828', 文本模型: 'doubao-1-5-pro-32k-250115' },
  openai: { 图像模型: 'gpt-image-1', 文本模型: 'gpt-4o-mini' },
  模拟: { 图像模型: '', 文本模型: '' },
}

$('#提供方').addEventListener('change', () => {
  const 值 = $('#提供方').value
  const 项 = (当前状态?.提供方列表 ?? []).find((条) => 条.值 === 值)
  const 默 = 模型默认[值]
  if (默) {
    $('#图像模型').value = 默.图像模型
    $('#文本模型').value = 默.文本模型
  }
  if (值 !== 'openai' && 值 !== 'ark') {
    $('#地址').placeholder = '仅「OpenAI 兼容」需要，例如 https://api.openai.com/v1'
  }
  if (项?.提示) 设置提示(项.提示)
})

// 沙箱预览（没有 allow-same-origin）里存储不可用，直接挂个横幅告诉用户该怎么用
if (!存储可用) {
  const 横幅 = document.querySelector('#沙箱提示')
  if (横幅) 横幅.hidden = false
  记('环境', '沙箱预览：localStorage 不可用，已切到内存存储')
}

// 首次渲染：空状态
画原图()
同步输出()
$('#版本').textContent = 版本
$('#缩放').disabled = true
$('#偏移X').disabled = true
$('#偏移Y').disabled = true
$('#容差').disabled = false

刷新状态(true)

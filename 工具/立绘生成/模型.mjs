// 模型适配层：把「生图 / 写人设 / 测连通」对不同的服务商统一成同一组函数。
//
// 三种提供方：
//   gemini  Google AI Studio（Gemini 3 Pro Image，也就是 Nano Banana Pro），原生 generateContent
//   openai  任何兼容 OpenAI 的 /v1/images/edits 的服务（gpt-image-1、多数国内厂商的兼容接口）
//   模拟    不联网，直接返回示例图，用来验证「前端 → 服务端 → 像素化」整条链路通不通
//
// 配置来源：进程环境变量优先，其次 …/.env.local（这个文件已被 .gitignore 的 .env.* 规则忽略）。
// 密钥只在这里被读，永远不回传给页面（/api/状态 只回答「有没有」）。

import { readFile, writeFile } from 'node:fs/promises'
import { 代理取 } from './代理.mjs'
import { fileURLToPath } from 'node:url'

const 配置文件 = fileURLToPath(new URL('./.env.local', import.meta.url))
const 示例图文件 = fileURLToPath(new URL('./示例/示例照片.png', import.meta.url))

export const 提供方表 = [
  {
    值: 'ark',
    名称: '火山方舟 · Seedream',
    提示: '国内直连可达。填方舟控制台的 API Key，模型填推理接入点 ID（ep-...）或 seedream 模型名。',
  },
  {
    值: 'gemini',
    名称: 'Google Gemini',
    提示: '填 AI Studio 的 key。国内直连 generativelanguage.googleapis.com 通常要走代理。',
  },
  {
    值: 'openai',
    名称: 'OpenAI 兼容',
    提示: '任何支持 /images/edits 的服务：填 Base URL（到 /v1 那一层）+ 模型名。',
  },
  {
    值: '模拟',
    名称: '模拟（不联网）',
    提示: '不发任何请求，直接回一张示例图，用来验证前端和像素化链路。',
  },
]

const ARK_地址 = 'https://ark.cn-beijing.volces.com/api/v3'

export const 默认配置 = {
  提供方: 'ark',
  密钥: '',
  地址: 'https://api.openai.com/v1',
  图像模型: 'gemini-3-pro-image-preview',
  文本模型: 'gemini-3-flash-preview',
  比例: '3:4',
  尺寸: '1024x1024',
  超时秒: 180,
}

const GEMINI_根地址 = 'https://generativelanguage.googleapis.com/v1beta'

let 缓存 = null

function 解析环境(文本) {
  const 结果 = {}
  for (const 行 of 文本.split(/\r?\n/)) {
    const 匹配 = 行.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!匹配) continue
    结果[匹配[1]] = 匹配[2].replace(/^["']|["']$/g, '')
  }
  return 结果
}

async function 读环境文件() {
  try {
    return 解析环境(await readFile(配置文件, 'utf8'))
  } catch {
    return {}
  }
}

async function 写环境文件(键值) {
  const 行 = Object.entries(键值).map(([键, 值]) => `${键}=${值}`)
  await writeFile(配置文件, `# 由「立绘生成」页面写入，含密钥，别提交\n${行.join('\n')}\n`, 'utf8')
}

// 环境变量 > .env.local > 默认值
export async function 读配置(强制 = false) {
  if (缓存 && !强制) return 缓存
  const 文件 = await 读环境文件()
  const 取 = (键, 环境名, 兜底) => process.env[环境名] ?? 文件[键] ?? 兜底
  const 提供方 = 取('AI_PROVIDER', 'AI_PROVIDER', 默认配置.提供方)
  缓存 = {
    提供方,
    密钥:
      process.env.AI_KEY ??
      process.env.GEMINI_API_KEY ??
      文件.AI_KEY ??
      文件.GEMINI_API_KEY ??
      默认配置.密钥,
    地址: 取('AI_BASE_URL', 'AI_BASE_URL', 提供方 === 'ark' ? ARK_地址 : 默认配置.地址),
    代理: 取('AI_PROXY', 'AI_PROXY', process.env.HTTPS_PROXY ?? process.env.https_proxy ?? ''),
    图像模型: 取(
      'AI_IMAGE_MODEL',
      'AI_IMAGE_MODEL',
      提供方 === 'ark' ? 'doubao-seedream-4-0-250828' : 默认配置.图像模型,
    ),
    文本模型: 取(
      'AI_TEXT_MODEL',
      'AI_TEXT_MODEL',
      提供方 === 'ark' ? 'doubao-1-5-pro-32k-250115' : 默认配置.文本模型,
    ),
    比例: 取('AI_ASPECT', 'AI_ASPECT', 默认配置.比例),
    尺寸: 取('AI_SIZE', 'AI_SIZE', 默认配置.尺寸),
    超时秒: Number(取('AI_TIMEOUT', 'AI_TIMEOUT', 默认配置.超时秒)) || 默认配置.超时秒,
  }
  return 缓存
}

export async function 存配置(部分) {
  const 当前 = await 读环境文件()
  if (部分?.清空密钥) {
    delete 当前.AI_KEY
    delete 当前.GEMINI_API_KEY
  }
  const 映射 = {
    提供方: 'AI_PROVIDER',
    密钥: 'AI_KEY',
    地址: 'AI_BASE_URL',
    代理: 'AI_PROXY',
    图像模型: 'AI_IMAGE_MODEL',
    文本模型: 'AI_TEXT_MODEL',
  }
  for (const [中文键, 环境键] of Object.entries(映射)) {
    const 值 = 部分?.[中文键]
    if (typeof 值 !== 'string') continue
    const 干净 = 值.trim()
    // 密钥留空 = 不修改（否则改个模型名就把 key 清掉了）；要清空请用「清除密钥」
    if ((中文键 === '密钥' || 中文键 === '代理') && !干净) continue
    // 密钥/地址要塞进 HTTP 头，混进中文或全角空格会报 ByteString 之类的怪错，这里先拦住
    if (干净 && (中文键 === '密钥' || 中文键 === '地址') && /[^\x20-\x7e]/.test(干净)) {
      const 错 = new Error(
        `${中文键}里有非 ASCII 字符（常见于复制时带了中文注释或全角空格），请只粘贴纯英文/数字的部分。`,
      )
      错.状态 = 400
      throw 错
    }
    if (干净) 当前[环境键] = 干净
    else delete 当前[环境键]
  }
  await 写环境文件(当前)
  缓存 = null
  return 读配置(true)
}

function 主机(地址) {
  try {
    return new URL(地址).host
  } catch {
    return 地址
  }
}

function 有密钥(配置) {
  if (配置.提供方 === '模拟') return true
  return Boolean(配置.密钥)
}

export async function 状态() {
  const 配置 = await 读配置()
  const 说明 = 提供方表.find((项) => 项.值 === 配置.提供方) ?? 提供方表[0]
  let 地址显示 = ''
  try {
    地址显示 = new URL(配置.地址).host
  } catch {
    地址显示 = 配置.地址
  }
  return {
    提供方: 配置.提供方,
    提供方名称: 说明.名称,
    提供方列表: 提供方表,
    有密钥: 有密钥(配置),
    可生图: 有密钥(配置),
    图像模型: 配置.图像模型,
    文本模型: 配置.文本模型,
    地址: 配置.提供方 === 'openai' || 配置.提供方 === 'ark' ? 地址显示 : '',
    代理: 配置.代理 ? 主机(配置.代理) : '',
    模拟: 配置.提供方 === '模拟',
  }
}

// ---- 错误翻译：让页面上的报错能直接照着做 ----

function 截断(文本, 长度 = 300) {
  return String(文本 ?? '').replace(/\s+/g, ' ').slice(0, 长度)
}

// 返回 Error（带 状态 字段），上层直接把 401/429/502 透给页面
function 译错误(状态码, 原文) {
  const 尾 = 截断(原文)
  const 错 = new Error()
  if (状态码 === 400) {
    错.message = `请求被拒（400）：模型可能不支持图片输入，或参数不对。上游：${尾}`
  } else if (状态码 === 401 || 状态码 === 403) {
    错.message = `密钥无效或没权限（${状态码}）：检查 key 是否有效、模型/接入点是否已开通。上游：${尾}`
  } else if (状态码 === 404) {
    错.message = `模型/接口不存在（404）：模型名或接入点 ID 可能写错了。上游：${尾}`
  } else if (状态码 === 429) {
    错.message = `配额或频率限制（429）：等一会儿，或换一个 key / 提高配额。上游：${尾}`
  } else if (状态码 >= 500) {
    错.message = `上游服务出错（${状态码}）：稍后重试。上游：${尾}`
  } else {
    错.message = `上游返回 ${状态码}：${尾}`
  }
  错.状态 = 状态码 === 401 || 状态码 === 403 ? 401 : 状态码 === 429 ? 429 : 502
  return 错
}

// 抛错（保留状态码）
function 抛错误(状态码, 原文) {
  throw 译错误(状态码, 原文)
}

// 统一出口：配了代理就走 CONNECT 隧道，否则直连。返回值形状和 fetch 一致。
async function 请求(配置, 地址, 选项 = {}) {
  const 毫秒 = (配置.超时秒 ?? 180) * 1000
  if (配置.代理) return 代理取(配置.代理, 地址, { ...选项, 毫秒 })
  const 响应 = await fetch(地址, { ...选项, signal: AbortSignal.timeout(毫秒) })
  return {
    ok: 响应.ok,
    status: 响应.status,
    headers: 响应.headers,
    text: () => 响应.text(),
    json: () => 响应.json(),
  }
}

async function 取文本(响应) {
  try {
    return await 响应.text()
  } catch {
    return ''
  }
}

// ---- Gemini ----

async function gemini请求(配置, 内容, 生成配置) {
  const 地址 = `${GEMINI_根地址}/models/${encodeURIComponent(配置.图像模型)}:generateContent?key=${encodeURIComponent(配置.密钥)}`
  const 响应 = await 请求(配置, 地址, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: 内容 }], generationConfig: 生成配置 }),
  })
  const 原文 = await 取文本(响应)
  if (!响应.ok) throw 译错误(响应.status, 原文)
  let 数据
  try {
    数据 = JSON.parse(原文)
  } catch {
    throw new Error(`Gemini 返回了非 JSON：${截断(原文, 160)}`)
  }
  if (数据?.promptFeedback?.blockReason) {
    throw new Error(`被安全策略拦下：${数据.promptFeedback.blockReason}（换个说法或换张照片试试）`)
  }
  const 片段 = 数据?.candidates?.[0]?.content?.parts ?? []
  const 图 = 片段.find((项) => 项?.inlineData?.data ?? 项?.inline_data?.data)
  const 文字 = 片段
    .map((项) => 项?.text)
    .filter(Boolean)
    .join('\n')
    .trim()
  return { 图, 文字 }
}

// 两段式里第一步要竖构图（2:3），第二步要 3:4；调用方传 比例 覆盖默认值。
function 尺寸按比例(比例, 兜底 = '1024x1024') {
  if (比例 === '2:3' || 比例 === '3:4' || 比例 === '9:16') return '1024x1536'
  if (比例 === '16:9' || 比例 === '4:3') return '1536x1024'
  return 兜底
}

async function gemini生图(配置, { 图片, 类型, 提示词, 比例 }) {
  const { 图, 文字 } = await gemini请求(
    配置,
    [
      { inline_data: { mime_type: 类型 || 'image/jpeg', data: 图片 } },
      { text: 提示词 },
    ],
    {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: 比例 || 配置.比例, imageSize: '1K' },
    },
  )
  if (!图) throw new Error(`模型只回了文字，没给图：${截断(文字, 240) || '（空）'}`)
  const 内容 = 图.inlineData ?? 图.inline_data
  return {
    图片: 内容.data,
    类型: 内容.mimeType ?? 内容.mime_type ?? 'image/png',
    说明: 文字,
  }
}

async function gemini人设(配置, { 图片, 类型, 提示词 }) {
  // 人设走文本模型：同一个接口，换成文本模型名 + JSON 模式
  const 地址 = `${GEMINI_根地址}/models/${encodeURIComponent(配置.文本模型)}:generateContent?key=${encodeURIComponent(配置.密钥)}`
  const 响应 = await 请求(配置, 地址, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: 类型 || 'image/jpeg', data: 图片 } },
            { text: 提示词 },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.9 },
    }),
  })
  const 原文 = await 取文本(响应)
  if (!响应.ok) throw 译错误(响应.status, 原文)
  const 数据 = JSON.parse(原文)
  const 文字 = (数据?.candidates?.[0]?.content?.parts ?? [])
    .map((项) => 项?.text)
    .filter(Boolean)
    .join('')
  return 文字
}

// ---- OpenAI 兼容（/images/edits）----

function 去尾斜杠(地址) {
  return String(地址).replace(/\/+$/, '')
}

// 火山方舟 Seedream：POST /images/generations，图片以 data URI 放在 image 字段里。
// 路径和鉴权已实测（假 key 返回 401 AuthenticationError，不是 404）。
function 方舟尺寸(比例, 兜底) {
  if (比例 === '2:3') return '1365x2048'
  if (比例 === '3:4') return '1536x2048'
  if (比例 === '1:1') return '2048x2048'
  return 兜底 || '2048x2048'
}

async function 方舟生图(配置, { 图片, 类型, 提示词, 比例 }) {
  const 响应 = await fetch(`${去尾斜杠(配置.地址)}/images/generations`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${配置.密钥}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 配置.图像模型,
      prompt: 提示词,
      image: `data:${类型 || 'image/png'};base64,${图片}`,
      size: 方舟尺寸(比例, 配置.尺寸),
      response_format: 'b64_json',
      watermark: false,
    }),
    signal: AbortSignal.timeout(配置.超时秒 * 1000),
  })
  const 原文 = await 取文本(响应)
  if (!响应.ok) throw 译错误(响应.status, 原文)
  let 数据
  try {
    数据 = JSON.parse(原文)
  } catch {
    throw new Error(`方舟返回了非 JSON：${截断(原文, 160)}`)
  }
  const 首张 = 数据?.data?.[0]
  if (!首张) throw new Error(`方舟没返回图片：${截断(原文, 240)}`)
  if (首张.b64_json) return { 图片: 首张.b64_json, 类型: 'image/png', 说明: '' }
  if (首张.url) {
    const 图响应 = await fetch(首张.url, { signal: AbortSignal.timeout(60_000) })
    if (!图响应.ok) throw new Error(`下载结果图失败：${图响应.status}`)
    const 缓冲 = Buffer.from(await 图响应.arrayBuffer())
    return { 图片: 缓冲.toString('base64'), 类型: 图响应.headers.get('content-type') ?? 'image/png', 说明: '' }
  }
  throw new Error('方舟返回既没有 b64_json 也没有 url')
}

async function openai生图(配置, { 图片, 类型, 提示词, 比例 }) {
  const 表单 = new FormData()
  表单.append('model', 配置.图像模型)
  表单.append('prompt', 提示词)
  表单.append('n', '1')
  表单.append('size', 尺寸按比例(比例, 配置.尺寸))
  表单.append(
    'image',
    new Blob([Buffer.from(图片, 'base64')], { type: 类型 || 'image/png' }),
    'input.png',
  )
  const 响应 = await fetch(`${去尾斜杠(配置.地址)}/images/edits`, {
    method: 'POST',
    headers: { authorization: `Bearer ${配置.密钥}` },
    body: 表单,
    signal: AbortSignal.timeout(配置.超时秒 * 1000),
  })
  const 原文 = await 取文本(响应)
  if (!响应.ok) throw 译错误(响应.status, 原文)
  let 数据
  try {
    数据 = JSON.parse(原文)
  } catch {
    throw new Error(`图片服务返回了非 JSON：${截断(原文, 160)}`)
  }
  const 首张 = 数据?.data?.[0]
  if (!首张) throw new Error(`图片服务没返回图片：${截断(原文, 240)}`)
  if (首张.b64_json) return { 图片: 首张.b64_json, 类型: 'image/png', 说明: 首张.revised_prompt ?? '' }
  if (首张.url) {
    const 图响应 = await fetch(首张.url, { signal: AbortSignal.timeout(60_000) })
    if (!图响应.ok) throw new Error(`下载结果图失败：${图响应.status}`)
    const 缓冲 = Buffer.from(await 图响应.arrayBuffer())
    return { 图片: 缓冲.toString('base64'), 类型: 图响应.headers.get('content-type') ?? 'image/png', 说明: '' }
  }
  throw new Error('图片服务返回既没有 b64_json 也没有 url')
}

async function openai人设(配置, { 图片, 类型, 提示词 }) {
  const 响应 = await fetch(`${去尾斜杠(配置.地址)}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${配置.密钥}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 配置.文本模型,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 提示词 },
            {
              type: 'image_url',
              image_url: { url: `data:${类型 || 'image/jpeg'};base64,${图片}` },
            },
          ],
        },
      ],
      temperature: 0.9,
    }),
    signal: AbortSignal.timeout(配置.超时秒 * 1000),
  })
  const 原文 = await 取文本(响应)
  if (!响应.ok) throw 译错误(响应.status, 原文)
  const 数据 = JSON.parse(原文)
  return 数据?.choices?.[0]?.message?.content ?? ''
}

// ---- 模拟 ----

async function 模拟生图() {
  const 字节 = await readFile(示例图文件)
  return {
    图片: 字节.toString('base64'),
    类型: 'image/png',
    说明: '模拟提供方：这张图是内置示例，不是你的照片。换成真实提供方才会按提示词重绘。',
  }
}

const 模拟人设 = {
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

// ---- 对外统一接口 ----

export async function 生图(请求) {
  const 配置 = await 读配置()
  保证有密钥(配置)
  if (配置.提供方 === '模拟') return 模拟生图(请求)
  if (配置.提供方 === 'ark') return 方舟生图(配置, 请求)
  if (配置.提供方 === 'openai') return openai生图(配置, 请求)
  return gemini生图(配置, 请求)
}

export async function 写人设(请求) {
  const 配置 = await 读配置()
  保证有密钥(配置)
  if (配置.提供方 === '模拟') return 模拟人设
  const 文字 =
    配置.提供方 === 'gemini'
      ? await gemini人设(配置, 请求)
      : await openai人设(配置, 请求) // 方舟的 /chat/completions 是 OpenAI 兼容的
  return 解析人设(文字)
}

function 保证有密钥(配置) {
  if (配置.提供方 === '模拟') return
  if (!配置.密钥) {
    const 错 = new Error(
      '没有配置密钥：页面上展开「模型设置」填一个并保存，或设置环境变量 AI_KEY 后重启服务。',
    )
    错.状态 = 400
    throw 错
  }
}

export function 解析人设(文字) {
  const 干净 = String(文字 ?? '')
    .replace(/```(?:json)?/gi, '')
    .trim()
  const 起 = 干净.indexOf('{')
  const 止 = 干净.lastIndexOf('}')
  if (起 < 0 || 止 <= 起) throw new Error(`人设不是 JSON：${截断(干净, 200)}`)
  return JSON.parse(干净.slice(起, 止 + 1))
}

// 测试连接：不产生生成费用，只验证 key / 地址 / 模型列表。
export async function 测连通() {
  try {
    return await 测连通内部()
  } catch (错误) {
    const 文 = String(错误?.message ?? 错误)
    const 网络问题 = /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|certificate|socket hang up/i.test(文)
    return {
      成功: false,
      说明: 网络问题 ? `连不上：${文}。检查网络、AI_BASE_URL 或代理。` : 文,
      候选模型: [],
    }
  }
}

async function 测连通内部() {
  const 配置 = await 读配置()
  if (配置.提供方 === '模拟') {
    return { 成功: true, 说明: '模拟提供方，不需要联网，天然可用。', 候选模型: [] }
  }
  保证有密钥(配置)
  if (配置.提供方 === 'ark') {
    // 方舟没有 /models 列表接口，用一个 1 token 的对话验 key（几乎不花钱）
    const 响应 = await fetch(`${去尾斜杠(配置.地址)}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${配置.密钥}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 配置.文本模型,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    const 原文 = await 取文本(响应)
    if (!响应.ok) return { 成功: false, 说明: 译错误(响应.status, 原文).message, 候选模型: [] }
    return {
      成功: true,
      说明: `连上火山方舟，key 有效。确认「图像模型」填的是已开通的 Seedream 接入点（${配置.图像模型}）。`,
      候选模型: [],
    }
  }
  if (配置.提供方 === 'openai') {
    const 响应 = await fetch(`${去尾斜杠(配置.地址)}/models`, {
      headers: { authorization: `Bearer ${配置.密钥}` },
      signal: AbortSignal.timeout(20_000),
    })
    const 原文 = await 取文本(响应)
    if (!响应.ok) return { 成功: false, 说明: 译错误(响应.status, 原文).message, 候选模型: [] }
    let 名字们 = []
    try {
      名字们 = (JSON.parse(原文)?.data ?? []).map((项) => 项.id).filter(Boolean)
    } catch {
      /* 有的服务不返回 JSON 列表 */
    }
    return {
      成功: true,
      说明: `连上了 ${new URL(配置.地址).host}，模型列表 ${名字们.length} 个。`,
      候选模型: 名字们.slice(0, 40),
    }
  }
  const 响应 = await 请求(
    配置,
    `${GEMINI_根地址}/models?key=${encodeURIComponent(配置.密钥)}&pageSize=200`,
  )
  const 原文 = await 取文本(响应)
  if (!响应.ok) return { 成功: false, 说明: 译错误(响应.status, 原文).message, 候选模型: [] }
  let 列表 = []
  try {
    列表 = (JSON.parse(原文)?.models ?? [])
      .filter((项) => !项.supportedGenerationMethods || 项.supportedGenerationMethods.includes('generateContent'))
      .map((项) => String(项.name ?? '').replace(/^models\//, ''))
      .filter(Boolean)
  } catch {
    /* 忽略 */
  }
  const 图像 = 列表.filter((名) => /image/i.test(名))
  return {
    成功: true,
    说明: 图像.length
      ? `密钥有效。可用图像模型 ${图像.length} 个，例如 ${图像.slice(0, 3).join('、')}。`
      : `密钥有效，但列表里没看到 image 模型，可能需要在项目里开通。`,
    候选模型: 图像.slice(0, 40),
  }
}

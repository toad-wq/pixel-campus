// 通过 HTTP 代理发 HTTPS 请求（CONNECT 隧道），零依赖。
//
// 为什么需要它：Node 的 fetch（undici）**不会**读系统代理设置，也不认 HTTPS_PROXY。
// 你在电脑上开了 Clash 之类，浏览器能上 Google，但 `node 服务端.mjs` 依然直连超时。
// 这里自己开隧道：先 CONNECT 到代理，再把 TLS 套在那条连接上。
//
// 用法：
//   $env:AI_PROXY="http://127.0.0.1:7890"
//   node 工具/立绘生成/服务端.mjs

import { request as http请求 } from 'node:http'
import { request as https请求 } from 'node:https'
import { connect as tls连接 } from 'node:tls'

// 返回的对象和 fetch 的 Response 形状接近：{ ok, status, headers, text(), json() }
export function 代理取(代理地址, 地址, 选项 = {}) {
  return new Promise((成功, 失败) => {
    let 目标
    let 代
    try {
      目标 = new URL(地址)
      代 = new URL(代理地址)
    } catch {
      失败(new Error(`代理或地址格式不对：${代理地址} / ${地址}`))
      return
    }
    if (目标.protocol !== 'https:') {
      失败(new Error('代理隧道只支持 https 目标'))
      return
    }
    const 超时 = 选项.毫秒 ?? 120_000

    const 隧道 = http请求({
      host: 代.hostname,
      port: Number(代.port || 80),
      method: 'CONNECT',
      path: `${目标.hostname}:443`,
      headers: { host: `${目标.hostname}:443` },
      timeout: 30_000,
    })

    隧道.on('connect', (隧道响应, 套接字) => {
      if (隧道响应.statusCode !== 200) {
        失败(new Error(`代理拒绝 CONNECT（${隧道响应.statusCode}）：${代理地址}`))
        return
      }
      const 请求 = https请求(
        {
          host: 目标.hostname,
          port: 443,
          path: `${目标.pathname}${目标.search}`,
          method: 选项.method ?? 'GET',
          headers: { ...(选项.headers ?? {}), host: 目标.hostname },
          createConnection: () => tls连接({ socket: 套接字, servername: 目标.hostname }),
          timeout: 超时,
        },
        (响应) => {
          const 块们 = []
          响应.on('data', (块) => 块们.push(块))
          响应.on('end', () => {
            const 文本 = Buffer.concat(块们).toString('utf8')
            成功({
              ok: 响应.statusCode >= 200 && 响应.statusCode < 300,
              status: 响应.statusCode,
              headers: 响应.headers,
              text: async () => 文本,
              json: async () => JSON.parse(文本),
            })
          })
        },
      )
      请求.on('error', 失败)
      请求.on('timeout', () => 请求.destroy(new Error('代理请求超时')))
      if (选项.body) 请求.write(选项.body)
      请求.end()
    })

    隧道.on('error', (错误) => 失败(new Error(`连不上代理 ${代理地址}：${错误.message}`)))
    隧道.on('timeout', () => 隧道.destroy(new Error(`连代理超时：${代理地址}`)))
    隧道.end()
  })
}

// 打包：把「服务端版」的三份脚本 + 样式 + 示例图塞进一个 HTML。
//
// 用途：浏览器连不上 127.0.0.1:5174 的时候（端口被占、被隔离、懒得起服务），
// 双击 单文件版.html 就能看全部像素化效果 —— 只是 AI 那两个按钮会置灰。
//
// 跑法：node 工具/立绘生成/打包.mjs

import { readFileSync, writeFileSync } from 'node:fs'

const 根 = new URL('./', import.meta.url)
const 读 = (名) => readFileSync(new URL(名, 根), 'utf8')

// 模块 → 普通脚本：去掉 import 行和行首 export
function 去模块化(代码) {
  return 代码
    .split('\n')
    .filter((行) => !/^import\s/.test(行))
    .map((行) => 行.replace(/^export\s+/, ''))
    .join('\n')
}

const 样式 = 读('样式.css')
const 示例 = readFileSync(new URL('./示例/示例照片.png', 根)).toString('base64')
const 脚本 = [读('像素化.mjs'), 读('提示词.mjs'), 读('主程序.js')].map(去模块化).join('\n\n')

let html = 读('索引.html')

const 样式标签 = '<link rel="stylesheet" href="./样式.css">'
if (!html.includes(样式标签)) throw new Error('索引.html 里的样式引用变了，打包脚本要同步')

const 脚本标签 = /<script type="module" src="\.\/主程序\.js"><\/script>/
if (!脚本标签.test(html)) throw new Error('索引.html 里的脚本引用变了，打包脚本要同步')

html = html.replace(样式标签, '<style>\n' + 样式 + '\n</style>')
html = html.replace(
  脚本标签,
  () =>
    '<script>\n' +
    'window.__离线 = true\n' +
    'window.__直连 = true\n' +
    'window.__示例图 = "data:image/png;base64,' + 示例 + '"\n' +
    脚本 +
    '\n</script>',
)

writeFileSync(new URL('./单文件版.html', 根), html)
console.log(`单文件版.html · ${(html.length / 1024).toFixed(0)} KB · ${html.split('\n').length} 行`)

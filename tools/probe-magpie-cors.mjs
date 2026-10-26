/**
 * 实测「浏览器里能不能直连 Magpie 网关」。
 *
 * 起因：要判断「用户在模型服务设置里填 http://127.0.0.1:3425/v1 就能用」是否成立。
 * 这件事只有两个判据，都必须在**真实浏览器 + 真实跨源**下量：
 *   1. 预检请求（OPTIONS）是否被放行 —— 带 application/json 的 POST 一定会触发预检；
 *   2. 响应是否带 Access-Control-Allow-Origin —— 没有它，浏览器会把 200 的响应丢掉，
 *      控制台只留一条 CORS 报错，fetch 直接 reject。
 *
 * 不能用 curl / PowerShell 代替：它们不做同源策略检查，
 * 会得出「能调」的结论，而这个结论在浏览器里是假的。
 *
 * 用法：node tools/probe-magpie-cors.mjs [页面地址]
 *   页面地址默认 http://localhost:5173/（需要 npm run dev 在跑）。
 *   测的是**页面所在源**与 127.0.0.1:3425 之间的跨源关系。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const pageUrl = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/'
const target = 'http://127.0.0.1:3425/v1/chat/completions'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()

// 把 CORS 失败从控制台里抓出来：这是「被浏览器拦下」的唯一可见证据
const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200))
})

await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

const result = await page.evaluate(async (url) => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'workbuddy/deepseek-v4.1-flash',
        messages: [{ role: 'user', content: 'ok' }],
        max_tokens: 8,
      }),
    })
    const text = await res.text()
    return { reached: true, status: res.status, body: text.slice(0, 200) }
  } catch (error) {
    // TypeError: Failed to fetch —— 就是 CORS 被拦下的样子
    return { reached: false, error: String(error && error.message) }
  }
}, target)

console.log(`页面源：${pageUrl}`)
console.log(`目标：${target}`)
console.log('')
if (result.reached) {
  console.log(`结论：浏览器直连**可行**（HTTP ${result.status}）`)
  console.log(`响应片段：${result.body}`)
} else {
  console.log(`结论：浏览器直连**不可行** —— fetch 被拦下（${result.error}）`)
}
if (consoleErrors.length) {
  console.log('')
  console.log('控制台错误（前 4 条）：')
  for (const line of consoleErrors.slice(0, 4)) console.log(`  · ${line}`)
}

await browser.close()
process.exit(result.reached ? 0 : 1)

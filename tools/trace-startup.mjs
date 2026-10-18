/**
 * 用浏览器 trace 抓出启动期间主线程到底花在哪些函数上。
 * 用法：node tools/trace-startup.mjs [url] [--out DIR]
 *
 * 为什么需要它：长任务只能告诉你「有 1 秒被占了」，不会告诉你是谁占的。
 * 静态读代码容易猜错（Vue 的渲染、watch 链、DOM 测量都可能），
 * 所以这里真的录一条 trace，再把热点函数聚合成一张榜。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:3001/editor'
const outFlag = process.argv.indexOf('--out')
const outDir = outFlag >= 0 ? process.argv[outFlag + 1] : './tools/trace'
const RUNS = Number(process.env.RUNS || 2)

const browser = await chromium.launch({ channel: 'msedge' })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()

const client = await context.newCDPSession(page)
await client.send('Network.enable')
await client.send('Network.emulateNetworkConditions', {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
})
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 })

const all = []
for (let i = 0; i < RUNS; i += 1) {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(outDir, { recursive: true })
  const events = []
  client.on('Tracing.dataCollected', ({ value }) => events.push(...value))
  await client.send('Tracing.start', {
    categories: 'devtools.timeline,v8.execute,disabled-by-default-devtools.timeline',
    transferMode: 'ReportEvents',
  })
  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(3500)
  const done = new Promise((resolve) => client.once('Tracing.tracingComplete', resolve))
  await client.send('Tracing.end')
  await done
  writeFileSync(`${outDir}/startup-${i + 1}.json`, JSON.stringify(events))
  all.push(events)
  console.log(`第 ${i + 1} 轮 trace：${events.length} 个事件 → ${outDir}/startup-${i + 1}.json`)
  await page.reload({ waitUntil: 'load' })
}

/* 聚合：把长任务里出现的函数调用按「自身耗时」排榜 */
const selfTime = new Map()
const byName = new Map()
for (const events of all) {
  // 建索引，便于找父节点
  let duration = 0
  for (const e of events) {
    if (e.name === 'FunctionCall' || e.name === 'EvaluateScript' || e.name === 'v8.run') {
      const d = (e.dur || 0) / 1000
      duration += d
      const frame = e.args?.data?.functionName || e.args?.data?.url || e.name
      if (!frame) continue
      const key = String(frame).slice(0, 70)
      selfTime.set(key, (selfTime.get(key) || 0) + d)
      byName.set(key, (byName.get(key) || 0) + 1)
    }
  }
  console.log(`  本轮可归因的函数耗时合计：${Math.round(duration)} ms`)
}

console.log('\n▌启动期间热点函数（按累计时长）')
const rows = [...selfTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)
for (const [name, ms] of rows) {
  console.log(`  ${String(Math.round(ms)).padStart(6)} ms  ×${String(byName.get(name)).padStart(4)}  ${name}`)
}

/* 再单独列出「长任务」本身，看它们的时长分布 */
console.log('\n▌长任务（>50ms）')
for (const events of all.slice(0, 1)) {
  const tasks = events.filter((e) => e.name === 'RunTask' && (e.dur || 0) > 50000)
  for (const t of tasks.sort((a, b) => (b.dur || 0) - (a.dur || 0)).slice(0, 8)) {
    console.log(`  ${Math.round((t.dur || 0) / 1000)} ms  ts=${Math.round((t.ts || 0) / 1000)}ms`)
  }
}

await browser.close()
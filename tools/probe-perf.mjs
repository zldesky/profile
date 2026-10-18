/**
 * 量真实加载性能（导航计时、资源体积、长任务、布局抖动）。
 * 用法：node tools/probe-perf.mjs [url]
 *
 * 为什么要单独量：体积数字看不出体验 —— 143 KB 的入口如果阻塞了首屏绘制，
 * 比 400 KB 的懒加载 chunk 更糟。这里量的是浏览器实际记到的里程碑。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:3001/'
const RUNS = 3

const browser = await chromium.launch({ channel: 'msedge' })

/** 4G 手机档：CPU 降速 4 倍、网络限速，避免在开发机的高速环境里得出乐观结论 */
const CPU_THROTTLE = 4
const NET = { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 }

for (let i = 1; i <= RUNS; i += 1) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const client = await context.newCDPSession(page)
  await client.send('Network.enable')
  await client.send('Network.emulateNetworkConditions', { offline: false, ...NET })
  await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })

  // 记录资源体积
  const resources = []
  page.on('response', async (res) => {
    try {
      const len = Number(res.headers()['content-length'] || 0)
      resources.push({ url: res.url(), type: res.request().resourceType(), len })
    } catch {
      /* 忽略 */
    }
  })

  // 长任务（>50ms 的阻塞主线程工作）
  await page.addInitScript(() => {
    window.__longTasks = []
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__longTasks.push(Math.round(e.duration))
      }).observe({ entryTypes: ['longtask'] })
    } catch {
      /* 不支持就算了 */
    }
  })

  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  const loadMs = Date.now() - t0

  /*
   * 精确定位启动各阶段。长任务只知道「有 1 秒被占了」，不知道是谁占的，
   * 所以这里量三个可分辨的里程碑：
   *  - 编辑器骨架出现在 DOM（.editor-panel）
   *  - 纸面渲染出来（.paper）
   *  - 主线程空闲（无长任务，用短定时器探测）
   */
  const timeline = await page.evaluate(async () => {
    const waitFor = (sel, limit = 8000) =>
      new Promise((resolve) => {
        const t = performance.now()
        if (document.querySelector(sel)) return resolve(Math.round(t))
        const timer = setInterval(() => {
          if (document.querySelector(sel)) {
            clearInterval(timer)
            resolve(Math.round(performance.now()))
          } else if (performance.now() - t > limit) {
            clearInterval(timer)
            resolve(null)
          }
        }, 16)
      })
    const panelAt = await waitFor('.editor-panel')
    const paperAt = await waitFor('.paper')
    // 探一次「主线程何时不再有长任务」：连续若干次 30ms 定时器都能准时触发
    const idleAt = await new Promise((resolve) => {
      let ok = 0
      let last = performance.now()
      const tick = () => {
        const now = performance.now()
        if (now - last < 60) ok += 1
        else ok = 0
        last = now
        if (ok >= 5) return resolve(Math.round(now))
        if (now > 12000) return resolve(null)
        setTimeout(tick, 30)
      }
      setTimeout(tick, 30)
    })
    return { panelAt, paperAt, idleAt }
  })

  await page.waitForTimeout(1200)

  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {}
    const paints = {}
    for (const p of performance.getEntriesByType('paint')) paints[p.name] = Math.round(p.startTime)
    return {
      ttfb: Math.round(nav.responseStart || 0),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEvent: Math.round(nav.loadEventEnd || 0),
      fcp: paints['first-contentful-paint'] || null,
      longTasks: window.__longTasks || [],
      transferKB: Math.round(
        performance.getEntriesByType('resource').reduce((n, r) => n + (r.transferSize || 0), 0) / 1024,
      ),
    }
  })

  const tl = timeline
  const longTotal = m.longTasks.reduce((a, b) => a + b, 0)
  console.log(`\n▌第 ${i} 次（4G 手机档：CPU ×${CPU_THROTTLE} 降速、1.6Mbps、150ms 延迟）`)
  console.log(`  真实耗时      : ${loadMs} ms（goto 到 load 事件）`)
  console.log(`  TTFB          : ${m.ttfb} ms`)
  console.log(`  首屏绘制 FCP  : ${m.fcp ?? '未记录'} ms`)
  console.log(`  DOMContentLoaded: ${m.domContentLoaded} ms`)
  console.log(`  load 事件     : ${m.loadEvent} ms`)
  console.log(`  长任务        : ${m.longTasks.length} 个，合计 ${longTotal} ms ${m.longTasks.length ? '→ ' + m.longTasks.slice(0, 6).join(', ') : ''}`)
  console.log(`  资源传输总量  : ${m.transferKB} KB`)
  console.log(
    `  启动里程碑    : 编辑器骨架 ${tl.panelAt ?? '—'} ms · 纸面 ${tl.paperAt ?? '—'} ms · 主线程空闲 ${tl.idleAt ?? '—'} ms`,
  )

  const top = resources
    .filter((r) => r.len > 0)
    .sort((a, b) => b.len - a.len)
    .slice(0, 8)
  console.log(`  最大的资源（按 content-length）：`)
  for (const r of top) console.log(`      ${String(Math.round(r.len / 1024)).padStart(5)} KB  ${r.type.padEnd(10)} ${r.url.split('/').pop()}`)

  await context.close()
}
await browser.close()
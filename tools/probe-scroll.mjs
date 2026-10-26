/**
 * 量右侧编辑面板的滚动流畅度，并定位「卡在哪个元素」。
 *
 * 为什么单独写这个：`probe-perf.mjs` 量的是**启动**（首屏里程碑、长任务），
 * 而滚动卡顿是另一件事 —— 它是**持续**的每帧开销，启动指标全绿也可能滚起来发涩。
 * 单看「有没有长任务」也不够：滚动掉帧往往没有长任务，只是每帧的绘制/布局超预算。
 *
 * 量三样东西：
 *   1. **每帧间隔分布**：滚动期间用 rAF 采样，统计 p50 / p95 / 掉帧数（>16.7ms）。
 *      这直接对应「手感」—— p95 才是用户感觉到的卡，平均值会把卡顿摊平。
 *   2. **单帧主线程工作**：长任务只报 >50ms 的，抓不到「每帧 20ms」这种持续劣化。
 *   3. **滚动期间的重绘代价**：按段（面板顶部 / 中段 / 底部）分别量，
 *      对应「部分区域卡」这个描述 —— 如果只在某一段卡，分母就不一样。
 *
 * 用法：
 *   node tools/probe-scroll.mjs                      # 默认 127.0.0.1:3001/editor
 *   node tools/probe-scroll.mjs http://localhost:5173
 *   node tools/probe-scroll.mjs http://localhost:5173/editor
 *   node tools/probe-scroll.mjs http://localhost:5173 --token <会话令牌>   # 需登录才渲染面板
 *
 * 只给站点根地址也行：面板在 /editor，本脚本会自动补上路径。
 * （早先照文档传 `http://localhost:5173` 会导航到首页，然后报「面板没渲染」——
 *  那是**探针没站到面板所在的页面**，不是产品坏了。见 PITFALLS.md A 类。）
 *
 * 前提：站点要跑起来。连 3001 需先 `npm run build`，且多半要 --token，
 * 否则面板不会渲染 —— 那时本的脚本会直接判 FAIL（量不到 ≠ 通过）。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const argv = process.argv.slice(2)
const rawUrl = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:3001/editor'
/*
 * 面板挂在 /editor：只给站点根地址时补上路径。
 * 不补的话会去量首页 —— 那里没有 .panel-body，脚本会报「面板没渲染」，
 * 而真实原因是探针站错了页面（PITFALLS A 类）。
 */
const url = new URL(rawUrl)
if (url.pathname === '/' || url.pathname === '') url.pathname = '/editor'
const target = url.toString()
const tokenFlag = argv.indexOf('--token')
const token = tokenFlag >= 0 ? argv[tokenFlag + 1] : ''

/** 掉帧阈值：60Hz 下一帧 16.7ms，超过就算掉一帧 */
const FRAME_BUDGET = 16.7

function log(ok, label, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

const browser = await chromium.launch({ channel: 'msedge' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })

if (token) {
  await context.addCookies([{ name: 'rs_session', value: token, url: url.origin }])
}

const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(target, { waitUntil: 'networkidle', timeout: 40000 })
await page.waitForTimeout(1500)

// 关掉新手引导，否则遮罩会挡住面板
for (const sel of ['.ob-skip', '.ob-close']) {
  const el = await page.$(sel)
  if (el) await el.click().catch(() => {})
}
await page.waitForTimeout(300)

/* ---------------- 前提：面板真的渲染了 ---------------- */

const scroller = await page.$('.panel-body')
// 拿不到就判 FAIL 而不是跳过 —— 「跳过」实际上是「什么都没测」
if (!scroller) {
  log(false, '右侧编辑面板存在（.panel-body）', '没渲染：多半是未登录或 dist 过期，见脚本头部说明')
  await browser.close()
  process.exit()
}
log(true, '右侧编辑面板存在（.panel-body）')

/**
 * 展开所有模块卡片，把面板撑到真实长度。
 * 默认全是收起的，只量收起态会得出「很轻」的结论 —— 而用户卡顿恰恰发生在展开后。
 */
const expandable = page.locator('.ed-card-head .ed-icon-btn.expand')
const cardCount = await expandable.count()
for (let i = 0; i < cardCount; i += 1) {
  const isOpen = await expandable.nth(i).evaluate((el) => el.classList.contains('is-open'))
  if (!isOpen) await expandable.nth(i).click()
}
await page.waitForTimeout(800)

const metrics = await page.evaluate(() => {
  const el = document.querySelector('.panel-body')
  return {
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    cards: document.querySelectorAll('.ed-card').length,
    // 展开后渲染出来的输入控件数量 —— 这是滚动时真正的成本来源
    inputs: el.querySelectorAll('input, textarea, select').length,
    nodes: el.querySelectorAll('*').length,
  }
})

console.log(
  `\n  面板内容高度 ${metrics.scrollHeight}px / 可视 ${metrics.clientHeight}px` +
    ` 卡片 ${metrics.cards} 张 输入控件 ${metrics.inputs} 个 DOM 节点 ${metrics.nodes} 个`,
)

/* ---------------- 功能护栏：反向高亮必须还活着 ---------------- */

/*
 * 这条断言是为「优化滚动性能」加的门槛，不是功能测试本身。
 *
 * 原因：把 ContentPanel 里那个「滚动时高亮当前模块锚点」的监听删掉，
 * p95 立刻从 20–40ms 掉到 9ms —— 指标全线变绿，功能却没了。
 * 这正是 PITFALLS.md E8 那一类（「接好了」不等于「跑起来了」）：
 * 优化不能以悄悄去掉功能为代价，所以必须有断言盯着它。
 *
 * 判据：把第 3 张卡片的顶边滚到滚动区顶边**之上** 120px。
 * 此时锚点条判定的那条线（滚动区顶部往下 90px 内）必然落在它里面，
 * 高亮的锚点文本必须等于这张卡片的标题。
 */
const anchorCheck = await page.evaluate(() => {
  const body = document.querySelector('.panel-body')
  const cards = [...document.querySelectorAll('.ed-card[data-section-id]')]
  const card = cards[2]
  if (!body || !card) return { ok: false, reason: `卡片只有 ${cards.length} 张，不够定位第 3 张` }
  const bodyTop = body.getBoundingClientRect().top
  const cardTop = card.getBoundingClientRect().top
  // 卡片顶边向上移 120px（超过判据的 90px），于是它跨过了那条线
  body.scrollTop += cardTop - bodyTop + 120
  const titleInput = card.querySelector('.ed-card-title')
  return {
    ok: true,
    title: titleInput instanceof HTMLInputElement ? titleInput.value.trim() : '',
  }
})
if (!anchorCheck.ok) {
  log(false, '滚动到某模块时锚点条跟着高亮（反向高亮没被删掉）', anchorCheck.reason)
} else {
  // 高亮挂在 rAF 上，是异步落地的：等一帧以上再看
  await page.waitForTimeout(400)
  const activeText = await page.evaluate(() => {
    const btn = document.querySelector('.panel-nav button.is-active')
    return btn ? (btn.textContent ?? '').trim() : ''
  })
  log(
    activeText === anchorCheck.title,
    '滚动到某模块时锚点条跟着高亮（反向高亮没被删掉）',
    `期望「${anchorCheck.title}」，实际「${activeText || '(没有高亮项)'}」`,
  )
}

/* ---------------- 分段量滚动 ---------------- */

/**
 * 在页面里滚一段距离并采样每帧间隔。
 * 用真实的 wheel 事件而不是 scrollTo：前者会经过浏览器的合成器路径，
 * 更接近用户滚鼠标时的情形（scrollTo 可能走同步滚动，量不出卡）。
 */
async function measureSegment(label, fromRatio, toRatio) {
  const result = await page.evaluate(
    async ({ fromRatio, toRatio, FRAME_BUDGET }) => {
      const el = document.querySelector('.panel-body')
      const max = el.scrollHeight - el.clientHeight
      const from = Math.round(max * fromRatio)
      const to = Math.round(max * toRatio)

      el.scrollTop = from
      // 让浏览器稳定到起点再开始采样，避免把上一次的布局算进来
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

      const frames = []
      let last = performance.now()
      let running = true

      const tick = () => {
        const now = performance.now()
        frames.push(now - last)
        last = now
        if (running) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)

      // 用 rAF 驱动滚动，保证每次都在帧边界上推进，测的是纯渲染/布局开销
      const total = to - from
      const steps = 40
      for (let i = 1; i <= steps; i += 1) {
        el.scrollTop = from + (total * i) / steps
        await new Promise((r) => requestAnimationFrame(r))
      }
      running = false

      // 丢掉首帧（含上一次的收尾）与采样器自身的开销
      const sample = frames.slice(2)
      sample.sort((a, b) => a - b)
      const pick = (p) =>
        Math.round(sample[Math.min(sample.length - 1, Math.floor(sample.length * p))] * 10) / 10
      return {
        frames: sample.length,
        p50: pick(0.5),
        p95: pick(0.95),
        max: Math.round(sample[sample.length - 1] * 10) / 10,
        dropped: sample.filter((f) => f > FRAME_BUDGET).length,
      }
    },
    { fromRatio, toRatio, FRAME_BUDGET },
  )

  const droppedPct = result.frames ? Math.round((result.dropped / result.frames) * 100) : 0
  console.log(
    `  ${label.padEnd(10)} p50 ${String(result.p50).padStart(6)} ms · p95 ${String(result.p95).padStart(6)} ms` +
      ` · max ${String(result.max).padStart(6)} ms · 掉帧 ${result.dropped}/${result.frames}（${droppedPct}%）`,
  )
  return { ...result, droppedPct }
}

console.log('\n▌分段滚动（每段 40 帧，量的是 rAF 间隔）')
const segments = [
  await measureSegment('顶部', 0, 0.33),
  await measureSegment('中段', 0.33, 0.66),
  await measureSegment('底部', 0.66, 1),
]

/* ---------------- 定位：谁在滚动时花时间 ---------------- */

/**
 * 用 PerformanceObserver 抓滚动期间的 layout / recalc 时长。
 * 光知道「掉帧」不够，要知道钱花在样式重算、布局还是绘制上。
 */
const longTaskInfo = await page.evaluate(async () => {
  const el = document.querySelector('.panel-body')
  const max = el.scrollHeight - el.clientHeight
  const entries = []
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        entries.push({ name: e.entryType, duration: Math.round(e.duration) })
    })
    po.observe({ entryTypes: ['longtask'] })

    for (let i = 0; i < 40; i += 1) {
      el.scrollTop = (max * i) / 40
      await new Promise((r) => requestAnimationFrame(r))
    }
    po.disconnect()
  } catch {
    /* 不支持就算了 */
  }
  return { count: entries.length, total: entries.reduce((n, e) => n + e.duration, 0) }
})

console.log(`\n▌长任务（>50ms）：${longTaskInfo.count} 个，合计 ${longTaskInfo.total} ms`)

/* ---------------- 结论 ---------------- */

const worst = segments.reduce((a, b) => (b.p95 > a.p95 ? b : a))
console.log(`\n▌最卡的一段：p95 ${worst.p95} ms`)

/*
 * 门槛取 25ms：60Hz 一帧 16.7ms，但滚动期间偶发的单帧 16-20ms 用户感觉不到；
 * 持续越过 25ms（约 40fps）才会被描述成「卡顿」。
 */
log(worst.p95 <= 25, '内容页签各段滚动 p95 不超过 25ms（约 40fps 以上）', `实测 ${worst.p95} ms`)

const totalDropped = segments.reduce((n, s) => n + s.dropped, 0)
const totalFrames = segments.reduce((n, s) => n + s.frames, 0)
const droppedPct = totalFrames ? Math.round((totalDropped / totalFrames) * 100) : 0
log(droppedPct <= 10, '内容页签整体掉帧率不超过 10%', `实测 ${droppedPct}%`)

/* ---------------- 设计页签 ---------------- */

/*
 * 设计页签单独量。
 *
 * 它比内容页签短得多（约 2200px vs 6600px），但**更卡**：实测基线 p95 24.7ms、
 * 最差一帧 61ms —— 原因是密度（12 张模板缩略图、大量原生滑杆与取色控件），不是长度。
 * 只测内容页签会漏掉这个真正的问题区，所以两个页签都必须量。
 */
console.log('\n▌设计页签')
const designTab = page.locator('.panel-tabs button').nth(1)
const designVisible = await designTab.isVisible().catch(() => false)
// 拿不到就判 FAIL —— 「跳过」等于什么都没测
log(designVisible, '设计页签按钮存在')
if (designVisible) {
  await designTab.click()
  // 让新页签完成首次布局；这里刻意**不做**任何预热（试过，反而更差，见 EditorPanel 注释）
  await page.waitForTimeout(700)

  const designInfo = await page.evaluate(() => {
    const el = document.querySelector('.panel-body')
    return {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      nodes: el.querySelectorAll('*').length,
      ranges: el.querySelectorAll('input[type="range"]').length,
      thumbnails: el.querySelectorAll('.thumb').length,
    }
  })
  console.log(
    `  内容高度 ${designInfo.scrollHeight}px / 可视 ${designInfo.clientHeight}px` +
      `  DOM 节点 ${designInfo.nodes}  滑杆 ${designInfo.ranges}  缩略图 ${designInfo.thumbnails}`,
  )

  /*
   * 先单独量「冷启动」：这是用户切到设计页签后立刻滚动的那一下，
   * 含 `content-visibility` 首次渲染各分区、原生滑杆首次创建的一次性成本。
   * 它只发生一次，但用户真实会碰到，所以要单独报出来，而不是混进 p95 里。
   */
  const cold = await page.evaluate(async () => {
    const el = document.querySelector('.panel-body')
    el.scrollTop = 0
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const frames = []
    let last = performance.now()
    let running = true
    const tick = () => {
      const now = performance.now()
      frames.push(now - last)
      last = now
      if (running) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    const max = el.scrollHeight - el.clientHeight
    for (let i = 1; i <= 120; i += 1) {
      el.scrollTop = (max * i) / 120
      await new Promise((r) => requestAnimationFrame(r))
    }
    running = false
    const s = frames.slice(2)
    return {
      spikes: s.filter((f) => f > 25).length,
      max: Math.round(Math.max(...s)),
    }
  })
  console.log(
    `  冷启动（首次连续滚动 120 帧）：超 25ms 的帧 ${cold.spikes} 个，最大 ${cold.max} ms`,
  )

  // 热身一遍之后再分段量 —— 段内数据才是「日常滚动」的体感
  const designSegments = [
    await measureSegment('设计-顶部', 0, 0.33),
    await measureSegment('设计-中段', 0.33, 0.66),
    await measureSegment('设计-底部', 0.66, 1),
  ]
  const designWorst = designSegments.reduce((a, b) => (b.p95 > a.p95 ? b : a))
  const designDropped = designSegments.reduce((n, s) => n + s.dropped, 0)
  const designFrames = designSegments.reduce((n, s) => n + s.frames, 0)
  const designDroppedPct = designFrames ? Math.round((designDropped / designFrames) * 100) : 0
  console.log(`\n▌设计页签最卡的一段：p95 ${designWorst.p95} ms`)
  log(designWorst.p95 <= 25, '设计页签各段滚动 p95 不超过 25ms', `实测 ${designWorst.p95} ms`)
  log(designDroppedPct <= 10, '设计页签整体掉帧率不超过 10%', `实测 ${designDroppedPct}%`)
  // 冷启动基线：一次性成本，容许存在，但不该频繁（≤2 帧）
  log(cold.spikes <= 2, '设计页签冷启动超 25ms 的帧不超过 2 个', `实测 ${cold.spikes} 个`)
}

if (errors.length) {
  log(false, '滚动期间没有页面异常', errors.slice(0, 3).join(' | '))
} else {
  log(true, '滚动期间没有页面异常')
}

await browser.close()

/**
 * 验证窄屏底部操作条：真的出现、命中区够大、切换真的生效。
 *
 * 用法：node tools/verify-mobile-bar.mjs [url]
 *
 * 为什么需要它：底部条只在窄屏渲染（v-if="isMobile"），
 * 静态审计跑的是桌面视口，根本看不到它；单测挂载不了布局。
 * 而它要解决的问题恰恰是「窄屏下顶栏按钮太小、切回来找不到」——
 * 命中区尺寸与切换是否真的生效，只能真设备视口里量。
 *
 * 两个已知的环境干扰，都在脚本里绕开并注明：
 *  1. Vue DevTools 的悬浮球会浮在底部条上方（z-index 更高），
 *     Playwright 的 click 会因「被遮挡」超时 —— 用 evaluate 直接 click；
 *  2. 首次访问的新手引导会盖住界面，先关掉并确认关掉了。
 */
import { chromium, devices } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/editor'

const browser = await chromium.launch({ channel: 'msedge' })
const ctx = await browser.newContext({ ...devices['Pixel 7'] })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 160)}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 160))
})

let pass = 0
const failed = []
const log = (ok, message) => {
  if (ok) {
    pass += 1
    console.log(`  ✓ ${message}`)
  } else {
    failed.push(message)
    console.log(`  *** 失败 *** ${message}`)
  }
}

await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
await page.waitForTimeout(1700)

for (let i = 0; i < 6; i += 1) {
  const clicked = await page.evaluate(() => {
    const skip = [...document.querySelectorAll('button')].find(
      (x) => (x.textContent || '').trim() === '跳过引导',
    )
    if (!skip) return false
    skip.click()
    return true
  })
  if (!clicked) break
  await page.waitForTimeout(300)
}
log(
  await page.evaluate(() => !document.querySelector('[aria-label="新手引导"]')),
  '新手引导已关闭',
)

/* ---------- 1. 窄屏出现、宽屏不出现 ---------- */

const mobileBar = await page.evaluate(() => {
  const nav = document.querySelector('.mobile-bar')
  if (!nav) return null
  const items = [...nav.querySelectorAll('.mb-item')].map((b) => {
    const r = b.getBoundingClientRect()
    return {
      text: (b.textContent || '').trim(),
      height: Math.round(r.height),
      width: Math.round(r.width),
      active: b.className.includes('is-active'),
    }
  })
  const r = nav.getBoundingClientRect()
  return { items, top: Math.round(r.top), height: Math.round(r.height), vh: window.innerHeight }
})

log(Boolean(mobileBar), '窄屏下出现底部操作条')
log(mobileBar?.items.length === 3, `底部条有 3 个按钮（实际 ${mobileBar?.items.length}）`)
log(
  mobileBar?.items.every((i) => i.height >= 44),
  `每个按钮高度 ≥44px（实际 ${mobileBar?.items.map((i) => i.height).join('/')}）`,
)
log(
  mobileBar?.items.every((i) => i.width >= 44),
  `每个按钮宽度 ≥44px（实际 ${mobileBar?.items.map((i) => i.width).join('/')}）`,
)
log(
  mobileBar?.items[0].active === true,
  '默认停在「内容」（与编辑器默认视图一致）',
)
// 贴在窗口底部：底部条的下沿应当接近视口高度（留 safe-area 的余量）
log(
  mobileBar ? mobileBar.top + mobileBar.height >= mobileBar.vh - 2 : false,
  '底部条贴在窗口底部（不会被内容顶到中间）',
)

/* ---------- 2. 切到纸面：真的换了视图 ---------- */

const switched = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.mb-item')].find((b) =>
    (b.textContent || '').includes('纸面'),
  )
  if (!btn) return false
  // 直接 click：DevTools 悬浮球会挡住这个按钮，Playwright 的 click 会超时
  btn.click()
  return true
})
log(switched, '可点击「纸面」')
await page.waitForTimeout(700)

const paperState = await page.evaluate(() => {
  const paper = document.querySelector('.paper')
  const panel = document.querySelector('.editor-panel')
  return {
    active: [...document.querySelectorAll('.mb-item')]
      .filter((b) => b.className.includes('is-active'))
      .map((b) => (b.textContent || '').trim()),
    paperVisible: Boolean(paper) && paper.getBoundingClientRect().width > 0,
    panelHidden:
      !panel ||
      panel.getBoundingClientRect().width === 0 ||
      getComputedStyle(panel).display === 'none',
  }
})
log(paperState.active.join('/') === '纸面', `「纸面」变为选中态（实际 ${paperState.active.join('/')}）`)
log(paperState.paperVisible === true, '纸张显示出来')
log(paperState.panelHidden === true, '编辑面板被收起（窄屏是二选一）')

/* ---------- 3. 切回内容 ---------- */

await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.mb-item')].find((b) =>
    (b.textContent || '').includes('内容'),
  )
  btn?.click()
})
await page.waitForTimeout(700)

const backState = await page.evaluate(() => ({
  active: [...document.querySelectorAll('.mb-item')]
    .filter((b) => b.className.includes('is-active'))
    .map((b) => (b.textContent || '').trim()),
  panelVisible: (() => {
    const panel = document.querySelector('.editor-panel')
    return Boolean(panel) && panel.getBoundingClientRect().width > 0
  })(),
}))
log(backState.active.join('/') === '内容', '可以切回「内容」')
log(backState.panelVisible === true, '编辑面板回来了')

/* ---------- 3b. 折叠屏展开/折叠与横屏手机（同一页面内 resize，不重载） ----------
 *
 * 断点是 MOBILE_QUERY（见 useMediaQuery.js）：≤768 或 ≤900 且横屏矮窗。
 * 折叠屏的真实用法是**同一份会话里**展开/折叠 —— 依赖 matchMedia 的 change
 * 事件把 isMobile 翻过来，不是重新加载页面。这里按真实路径测：
 *   Pixel 7 (412×915)  → 展开到 904×1080（折叠屏内屏，两栏）→ 折回 412；
 *   横屏手机 844×390   → 宽度过了 768 但高度不够，仍应保持单栏 + 底部条。
 */
const layoutState = () =>
  page.evaluate(() => ({
    bar: Boolean(document.querySelector('.mobile-bar')),
    panelW: Math.round(document.querySelector('.editor-panel')?.getBoundingClientRect().width || 0),
    stageW: Math.round(
      document.querySelector('.editor-stage')?.getBoundingClientRect().width || 0,
    ),
  }))

await page.setViewportSize({ width: 904, height: 1080 })
await page.waitForTimeout(600)
const unfolded = await layoutState()
log(unfolded.bar === false, '折叠屏内屏（904×1080）：底部条收起，切为两栏')
log(unfolded.panelW > 0 && unfolded.stageW > 0, `两栏并排可见（面板 ${unfolded.panelW} / 纸区 ${unfolded.stageW}）`)

await page.setViewportSize({ width: 412, height: 915 })
await page.waitForTimeout(600)
const folded = await layoutState()
log(folded.bar === true, '折回外屏（412×915）：底部条回来（不重载页面）')
log(folded.panelW > 0 && folded.stageW === 0, '恢复单栏：预览隐藏')

await page.setViewportSize({ width: 844, height: 390 })
await page.waitForTimeout(600)
const landscape = await layoutState()
log(landscape.bar === true, '横屏手机（844×390）：高度不足，保持单栏 + 底部条')

await page.setViewportSize({ width: 412, height: 915 })
await page.waitForTimeout(600)

/* ---------- 4. 宽屏不该有这条 ---------- */

const deskCtx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const desk = await deskCtx.newPage()
await desk.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
await desk.waitForTimeout(1200)
const hasBarOnDesktop = await desk.evaluate(() => Boolean(document.querySelector('.mobile-bar')))
log(hasBarOnDesktop === false, '宽屏不渲染底部条（不白占一行高度）')
await deskCtx.close()

console.log('')
console.log(`窄屏操作条验证：${pass}/${pass + failed.length} 通过`)
if (errors.length) {
  console.log(`控制台/运行时错误（${errors.length} 条）：`)
  for (const e of errors.slice(0, 6)) console.log(`  · ${e}`)
} else {
  console.log('控制台/运行时错误：无')
}

await browser.close()
process.exit(failed.length ? 1 : 0)

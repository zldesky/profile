/**
 * 验证右侧编辑面板的宽度拉伸。
 * 用法：node tools/verify-panel-resize.mjs [url]
 *
 * 为什么要专门验：拖拽是纯交互，静态审计看不见；而它有几个**只会静默失效**的点：
 *  - 宽度写进了 CSS 变量但面板的 flex 没读它（拖了没反应）；
 *  - 拖的方向反了（向右拖反而变宽）；
 *  - 越界没夹住（能把预览区挤没）；
 *  - 拖完不落盘（刷新就回到默认）。
 * 这些编译、类型、单测全都发现不了。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/editor'

const browser = await chromium.launch({ channel: 'msedge' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 120)}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 120))
})

async function openEditor() {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForTimeout(1300)
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '跳过引导')
    if (s) s.click()
  })
  await page.waitForTimeout(400)
}

/** 面板宽 / 预览区宽 / 分隔条位置 */
const geometry = () =>
  page.evaluate(() => {
    const panel = document.querySelector('.editor-panel')
    const stage = document.querySelector('.editor-stage')
    const grip = document.querySelector('.panel-resizer')
    return {
      panel: panel ? Math.round(panel.getBoundingClientRect().width) : null,
      stage: stage ? Math.round(stage.getBoundingClientRect().width) : null,
      resizer: Boolean(grip),
      resizerW: grip ? Math.round(grip.getBoundingClientRect().width) : 0,
      varValue: getComputedStyle(document.querySelector('.editor-main')).getPropertyValue('--panel-w').trim(),
    }
  })

const savedWidth = () =>
  page.evaluate(() => {
    try {
      return localStorage.getItem('resume-studio-panel-width-v1')
    } catch {
      return '(读不到)'
    }
  })

let pass = 0
const TOTAL = 8

await openEditor()
// 清掉上次遗留的宽度，保证从默认值开始
await page.evaluate(() => {
  try {
    localStorage.removeItem('resume-studio-panel-width-v1')
  } catch {
    /* 忽略 */
  }
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1300)
await page.evaluate(() => {
  const s = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '跳过引导')
  if (s) s.click()
})
await page.waitForTimeout(400)

/* ---------- 1. 手柄存在、默认宽度、且「变量 = 实测」 ---------- */
const before = await geometry()
{
  /*
   * 这条不变量是关键：--panel-w 与面板实测宽度必须一致。
   * 少了它就会漏掉「变量已经变了、但面板因为 min-width:auto 停在固有宽度」
   * 这一类 bug —— 实测就是这样漏过了一轮：--panel-w=280 而面板 321px，
   * 表现成「最后 41px 拖不动」，而当时宽松的断言（只查方向）判它通过。
   */
  const consistent = before.varValue === `${before.panel}px`
  const ok = before.resizer && before.panel === 340 && consistent
  if (ok) pass += 1
  console.log(
    `  ${ok ? '✓' : '***'} ① 分隔条=${before.resizer}（宽 ${before.resizerW}px）· 面板 ${before.panel}px（期望 340）· --panel-w=${before.varValue}（须与实测一致）`,
  )
}

/* ---------- 2. 向右拖：面板应变窄 ---------- */
{
  const box = await page.evaluate(() => {
    const g = document.querySelector('.panel-resizer')
    if (!g) return null
    const r = g.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (!box) {
    console.log('  *** ② 拿不到分隔条坐标')
  } else {
    await page.mouse.move(box.x, box.y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(box.x + i * 6, box.y)
    await page.mouse.move(box.x + 60, box.y)
    await page.waitForTimeout(150)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await geometry()
    /*
     * 精确断言：340 - 60 = 280，而 280 正好是下限，所以这条同时验了「位移精确生效」
     * 与「下限夹得住」。只写 after.panel < before.panel 会放过「拖 60 只动 19」这种情况。
     */
    const ok = after.panel === 280 && after.varValue === '280px'
    if (ok) pass += 1
    console.log(
      `  ${ok ? '✓' : '***'} ② 向右拖 60px：面板 ${before.panel} → ${after.panel}px（期望恰好 280 = 下限）· 预览 ${before.stage} → ${after.stage}px`,
    )
  }
}

/* ---------- 3. 向左拖：面板应变宽，且不越过上限 ---------- */
{
  const box = await page.evaluate(() => {
    const g = document.querySelector('.panel-resizer')
    if (!g) return null
    const r = g.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  const start = (await geometry()).panel
  if (!box) {
    console.log('  *** ③ 拿不到分隔条坐标')
  } else {
    // 拖很远，验证上限真的夹住了
    await page.mouse.move(box.x, box.y)
    await page.mouse.down()
    for (let i = 1; i <= 14; i += 1) await page.mouse.move(box.x - i * 20, box.y)
    await page.waitForTimeout(150)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await geometry()
    // 精确：从 280 向左 280 → 560（且未触及上限 640）
    const ok = after.panel === 560 && after.varValue === '560px' && after.stage >= 420
    if (ok) pass += 1
    console.log(
      `  ${ok ? '✓' : '***'} ③ 向左拖 280px：面板 ${start} → ${after.panel}px（期望恰好 560）· 预览区仍有 ${after.stage}px`,
    )
  }
}

/* ---------- 3b. 拖到超出上限时应夹在 640 ---------- */
{
  const box = await page.evaluate(() => {
    const g = document.querySelector('.panel-resizer')
    if (!g) return null
    const r = g.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (!box) {
    console.log('  *** ③b 拿不到分隔条坐标')
  } else {
    // 一路拖到屏幕最左边，远超上限
    await page.mouse.move(box.x, box.y)
    await page.mouse.down()
    await page.mouse.move(20, box.y, { steps: 20 })
    await page.waitForTimeout(200)
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await geometry()
    const ok = after.panel === 640 && after.varValue === '640px'
    if (ok) pass += 1
    console.log(`  ${ok ? '✓' : '***'} ③b 拖到超出上限：面板停在 ${after.panel}px（期望 640 = 上限）`)
  }
}

/* ---------- 4. 拖完落盘 ---------- */
{
  const saved = await savedWidth()
  const now = (await geometry()).panel
  const ok = saved !== null && Number(saved) === now
  if (ok) pass += 1
  console.log(`  ${ok ? '✓' : '***'} ④ 落盘：localStorage=${saved} · 当前面板宽 ${now}px`)
}

/* ---------- 5. 刷新后宽度保持 ---------- */
{
  const now = (await geometry()).panel
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1300)
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '跳过引导')
    if (s) s.click()
  })
  await page.waitForTimeout(400)
  const after = await geometry()
  const ok = after.panel === now
  if (ok) pass += 1
  console.log(`  ${ok ? '✓' : '***'} ⑤ 刷新后：${after.panel}px（刷新前 ${now}px）`)
}

/* ---------- 6. 键盘：方向键调、双击复位 ---------- */
{
  const before = (await geometry()).panel
  await page.evaluate(() => document.querySelector('.panel-resizer')?.focus())
  await page.waitForTimeout(150)
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'separator')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(250)
  const afterKey = (await geometry()).panel

  await page.evaluate(() => {
    const g = document.querySelector('.panel-resizer')
    g?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  })
  await page.waitForTimeout(400)
  const afterReset = (await geometry()).panel

  const ok = focused && afterKey !== before && afterReset === 340
  if (ok) pass += 1
  console.log(
    `  ${ok ? '✓' : '***'} ⑥ 键盘：可聚焦=${focused} · 方向键 ${before} → ${afterKey}px · 双击复位 → ${afterReset}px（期望 340）`,
  )
}

/* ---------- 7. 窄屏不应出现分隔条 ---------- */
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(700)
{
  const st = await page.evaluate(() => ({
    resizer: Boolean(document.querySelector('.panel-resizer')),
    panel: document.querySelector('.editor-panel')
      ? Math.round(document.querySelector('.editor-panel').getBoundingClientRect().width)
      : null,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  const ok = !st.resizer && st.overflow <= 0
  if (ok) pass += 1
  console.log(`  ${ok ? '✓' : '***'} ⑦ 390px 窄屏：分隔条=${st.resizer}（应无）· 面板 ${st.panel}px · 横向溢出 ${st.overflow}px`)
}

console.log('')
console.log(`面板宽度拉伸：${pass}/${TOTAL} 项通过`)
console.log('运行时错误:', errors.length ? errors.join(' | ') : '无')
const ok = pass === TOTAL && !errors.length
console.log(ok ? '全部通过' : '*** 有未通过项 ***')
await browser.close()
process.exit(ok ? 0 : 1)
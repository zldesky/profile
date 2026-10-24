/**
 * 验证「末页太空」提示：真的出现、文案带真实百分比、一页时不出现。
 *
 * 用法：node tools/verify-page-fill.mjs [url]
 *
 * 为什么需要它：utils/pageFill 有 14 例单测，但那些用的是人造块。
 * 这里的重点是**产品链路**：块几何来自真实布局（usePageMetrics.debugBlocks），
 * 提示来自真实渲染（PreviewToolbar），两者必须对得上。
 *
 * 难点是「怎么稳定造出末页很空」。试过加要点、隐藏模块，都受模板与内容长度影响，
 * 结果不稳定（实测 19% 就不算稀疏）。可靠做法是**直接改数据**：
 * 把页面内容压到「第 1 页接近满、第 2 页只剩一行」，这在语义上也最接近真实场景 ——
 * 用户遇到这个问题时，往往就是「删到刚好溢出一点点」。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/editor'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } })

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
await page.waitForTimeout(1500)

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

/** 读当前状态：页数徽标、提示文案、块几何 */
const readState = () =>
  page.evaluate(async () => {
    const geom = window.__pageMetrics?.debugBlocks?.()
    const mod = geom ? await import('/src/utils/pageFill.ts') : null
    const report = mod && geom ? mod.analyzePageFill(geom.blocks, geom.usableHeight) : null
    return {
      badge: (document.querySelector('.page-badge') || {}).textContent || '',
      hasHint: Boolean(document.querySelector('.page-hint')),
      hint: (document.querySelector('.page-hint-text') || {}).textContent || '',
      report,
    }
  })

/* ---------- 1. 示例简历：一页，不应有提示 ---------- */

const single = await readState()
log(/1 页/.test(single.badge), `示例简历是 1 页（实际「${single.badge}」）`)
log(single.hasHint === false, '单页简历不显示末页提示（单页没有「末页」可言）')

/* ---------- 2. 精确造一个「第 2 页只剩一点」的简历 ---------- */

/*
 * 注入方式：走页面上真实的 UI 动作（加要点 + 填内容），而不是直接写 localStorage。
 *
 * 试过直接写 localStorage 的 `resume-studio-v1`，结果完全没生效 ——
 * 因为主文档键之外还有「文档登记表 + 当前文档 id」两层，
 * 而且 store 启动时会按登记表决定读哪个槽位。绕过 store 去猜存储结构，
 * 等于把「验证工具」写成「依赖内部实现的脆弱探针」（PITFALLS.md A 类）。
 *
 * 走 UI 虽然慢一点，但它验证的正是用户能走通的路径。
 */
const workIndex = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('.ed-card .ed-card-title')]
  return inputs.findIndex((el) => (el.value || '').trim() === '工作经历')
})
log(workIndex >= 0, '找到「工作经历」模块')
if (workIndex < 0) {
  await browser.close()
  process.exit(1)
}
await page.locator('.ed-icon-btn.expand').nth(workIndex).click()
await page.waitForTimeout(600)

/*
 * 步进式微调：逐条增加要点并填写，直到末页占比掉进「稀疏」区间。
 *
 * 踩过的坑（每个都让页数纹丝不动，看起来像功能没做）：
 *  1. **不要先批量加空要点再填**。空要点几乎不占高度，节奏会失效。
 *  2. **不要用 `nth(count-1)` 定位新要点**。刚点完「添加要点」时，
 *     列表里已经有多个空 textarea，count 取到的末项未必是刚建的那条 ——
 *     实测结果是：21 条里只有 1 条有内容，其余全空，页数自然一直是 1 页。
 *     可靠做法是**按「值为空」找第一个**，那一定就是还没填的那条。
 *  3. **不能硬编码数量**。块高度受字体与模板影响，写死数量在别的机器上就跑偏。
 */
const MAX_EXTRA = 16
let sparse = await readState()
for (let extra = 0; extra < MAX_EXTRA && !sparse.report?.sparseLastPage; extra += 1) {
  await page
    .locator('.ed-card')
    .nth(workIndex)
    .locator('button', { hasText: '添加要点' })
    .first()
    .click()
  await page.waitForTimeout(250)

  // 找第一个空的 textarea —— 新建的那条一定是空的
  const filled = await page.evaluate((cardIndex) => {
    const card = document.querySelectorAll('.ed-card')[cardIndex]
    if (!card) return false
    const empty = [...card.querySelectorAll('.ed-bullet-row textarea')].find(
      (el) => el.value.trim() === '',
    )
    if (!empty) return false
    const total = card.querySelectorAll('.ed-bullet-row textarea').length
    empty.focus()
    return { total }
  }, workIndex)

  if (!filled) {
    console.log('    · 没有找到空要点，停止追加')
    break
  }

  const inputs = page.locator('.ed-card').nth(workIndex).locator('.ed-bullet-row textarea')
  const emptyIndex = await page.evaluate((cardIndex) => {
    const card = document.querySelectorAll('.ed-card')[cardIndex]
    const list = [...card.querySelectorAll('.ed-bullet-row textarea')]
    return list.findIndex((el) => el.value.trim() === '')
  }, workIndex)

  await inputs
    .nth(emptyIndex)
    .fill(
      `主导第 ${filled.total} 项系统改造，接口耗时从 800ms 降到 120ms，错误率下降 ${filled.total * 4}%。`,
    )
  await page.waitForTimeout(700)

  sparse = await readState()
  console.log(
    `    · 共 ${filled.total} 条：${sparse.report?.pageCount} 页，末页 ${Math.round((sparse.report?.lastPageRatio ?? 0) * 100)}%`,
  )
}

log(sparse.report?.pageCount >= 2, `长简历被分成 ${sparse.report?.pageCount ?? '?'} 页`)

/* ---------- 3. 末页稀疏时必须出现提示，且百分比来自真实数据 ---------- */

if (sparse.report?.sparseLastPage) {
  log(sparse.hasHint === true, '末页稀疏时提示出现')
  const expectedPercent = Math.round(sparse.report.lastPageRatio * 100)
  log(
    sparse.hint.includes(`${expectedPercent}%`),
    `提示里的百分比是真实值（${expectedPercent}%，实际文案「${sparse.hint}」）`,
  )
  log(/精简|删|收紧/.test(sparse.hint), `提示给出了可执行的动作（实际「${sparse.hint}」）`)
  /*
   * 工具条那句要短：它和缩放、页数、「压缩到一页」并排。
   * 第一版文案 40+ 字，实测被截成「…删掉一两条要点或稍…」，
   * 后半句正好是最有用的建议。这条断言把「短」变成可验证的要求。
   */
  log(sparse.hint.length <= 30, `工具条文案够短，不会被截断（${sparse.hint.length} 字）`)
} else {
  /*
   * 若这一份没造出稀疏（字体与模板会影响行高），**不能判 PASS** ——
   * 那正是「看起来通过、其实没测到」。这里判 FAIL 并说明原因，
   * 让人知道要调数据而不是以为功能没问题。
   */
  log(
    false,
    `未能造出末页稀疏的情形（末页占比 ${Math.round((sparse.report?.lastPageRatio ?? 0) * 100)}%），本条无法验证`,
  )
}

console.log('')
console.log(`末页提示验证：${pass}/${pass + failed.length} 通过`)
if (errors.length) {
  console.log(`控制台/运行时错误（${errors.length} 条）：`)
  for (const e of errors.slice(0, 6)) console.log(`  · ${e}`)
} else {
  console.log('控制台/运行时错误：无')
}

await browser.close()
process.exit(failed.length ? 1 : 0)

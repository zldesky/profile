/**
 * 验证模块的位置与间距设置：四个方向都能作用到纸面，且卡片头部可直接打开面板。
 *
 * 为什么需要它：`tests/sectionStyle.test.js` 只验「设置 → 内联样式」的换算，
 * `tests/sanitize.test.js` 只验服务端白名单。两段都通过，也不代表
 * 「点开面板、拖滑杆、纸面真的变了」——中间还隔着组件接线、CSS 变量作用域、
 * 主题的 `--gap` 叠加。这类断链只有真开浏览器点一遍才发现（本项目
 * verify-templates / verify-dialogs 等脚本也是同一理由）。
 *
 * 运行前提：另开一个终端跑 `npm run dev`（默认 5173）。
 * 不需要后端 —— 本脚本只验前端渲染，/api 的 502 属预期，已在下方过滤。
 */
/*
 * playwright-core 装在 server/node_modules（PDF 渲染用它），
 * 根目录没装，所以这里按项目约定走相对路径 —— 与其余 tools/*.mjs 一致。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const BASE = 'http://localhost:5173'

function log(ok, label, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

const browser = await chromium.launch({ channel: 'msedge', args: ['--font-render-hinting=none'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto(`${BASE}/editor`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// 隐藏可能的引导弹窗，避免挡住面板
for (const sel of ['.ob-skip', '.ob-close', '.ad-mask button[aria-label="关闭"]']) {
  const el = await page.$(sel)
  if (el) await el.click().catch(() => {})
}
await page.waitForTimeout(400)

// ---- 1. 卡片头部存在「布局」按钮 ----
const layoutBtns = page.locator('.ed-card-head .ed-icon-btn[title="调整位置与间距"]')
const cardCount = await page.locator('.ed-card').count()
const layoutBtnCount = await layoutBtns.count()
log(cardCount > 0, '模块卡片已渲染', `${cardCount} 张`)
log(layoutBtnCount === cardCount, '每张卡片都有「布局」按钮', `${layoutBtnCount}/${cardCount}`)

// ---- 2. 点布局按钮：展开卡片并打开面板 ----
const firstCard = page.locator('.ed-card').first()
await firstCard.locator('.ed-icon-btn[title="调整位置与间距"]').click()
await page.waitForTimeout(500)

const bodyVisible = await firstCard.locator('.ed-card-body').isVisible()
log(bodyVisible, '点「布局」后卡片已展开')

const panelOpen = await firstCard.locator('.layout-body').isVisible()
log(panelOpen, '点「布局」后位置面板直接打开')

// ---- 3. 四个方向的滑杆都在 ----
const labels = await firstCard.locator('.layout-body .ed-row > .ed-label').allInnerTexts()
const need = ['上方', '下方', '左侧', '右侧']
const missing = need.filter((n) => !labels.includes(n))
log(missing.length === 0, '四个方向的滑杆齐全', labels.join(' / '))

// ---- 4. 拖右侧滑杆 → 纸面真的变了 ----
const paperSection = page.locator('.paper .r-sec').first()
const beforeRight = await paperSection.evaluate((el) => getComputedStyle(el).paddingRight)

const rightSlider = firstCard
  .locator('.layout-body .ed-row')
  .filter({ hasText: '右侧' })
  .locator('input[type="range"]')
await rightSlider.evaluate((el) => {
  el.value = '20'
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForTimeout(600)
const afterRight = await paperSection.evaluate((el) => getComputedStyle(el).paddingRight)
log(afterRight === '20px', '右侧间距作用到纸面', `${beforeRight} → ${afterRight}`)

// ---- 5. 下方间距作用到纸面 ----
const bottomSlider = firstCard
  .locator('.layout-body .ed-row')
  .filter({ hasText: '下方' })
  .locator('input[type="range"]')
await bottomSlider.evaluate((el) => {
  el.value = '12'
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForTimeout(600)
const bottomStyle = await paperSection.evaluate((el) => getComputedStyle(el).marginBottom)
log(bottomStyle !== '0px', '下方间距作用到纸面', bottomStyle)

// ---- 6. 显隐仍然可用 ----
const eyeBtn = firstCard.locator('.ed-icon-btn[title="在简历中隐藏"]')
const eyeExists = (await eyeBtn.count()) > 0
log(eyeExists, '显隐按钮仍在')
if (eyeExists) {
  await eyeBtn.click()
  await page.waitForTimeout(400)
  const hiddenClass = await firstCard.evaluate((el) => el.classList.contains('is-hidden'))
  log(hiddenClass, '点隐藏后卡片进入 is-hidden 态')
  await firstCard.locator('.ed-icon-btn[title="在简历中显示"]').click()
  await page.waitForTimeout(300)
}

// ---- 7. 拖拽手柄仍在 ----
const handles = await page.locator('.ed-card-head .ed-drag').count()
log(handles === cardCount, '拖拽手柄齐全', `${handles}/${cardCount}`)

// ---- 8. 收起卡片后布局状态重置 ----
await firstCard.locator('.ed-icon-btn.expand').click()
await page.waitForTimeout(400)
await firstCard.locator('.ed-icon-btn[title="调整位置与间距"]').click()
await page.waitForTimeout(400)
const reopenedPanel = await firstCard.locator('.layout-body').isVisible()
log(reopenedPanel, '再次点「布局」可重新打开面板')

await page.screenshot({ path: 'gui-test-screenshots/layout-four-way.png', fullPage: false })

// ---- 9. 采集运行期错误 ----
/*
 * 只认真正的 JS 运行期错误。
 *
 * 刻意排除两类噪音：
 *  - `/api` 的 502：本脚本只跑前端（npm run dev），后端没起时 Vite 代理必然 502。
 *    把网络失败算成错误，会让「后端没开」看起来像「代码坏了」——这正是项目
 *    PITFALLS 里反复记的那类假失败。
 *  - favicon / DevTools 提示。
 */
const realErrors = errors.filter(
  (e) =>
    !/favicon|DevTools|Download the Vue Devtools/i.test(e) &&
    !/Failed to load resource/i.test(e) &&
    !/502|Bad Gateway/i.test(e),
)
log(realErrors.length === 0, '无运行期 JS 错误', realErrors.slice(0, 3).join(' | '))

await browser.close()
console.log('\n=== 完成 ===')

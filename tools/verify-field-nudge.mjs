/**
 * 验证「按住字段直接拖动微调间距」。
 *
 * 要点：
 *  - 按住字段拖到右下方 → 左缩进(indent) 与上方间距(extraGap) 增大；
 *  - 拖动途中元素跟手（transform 位移），松手后 transform 复位、值落到内联样式；
 *  - 拖动字段**不会**把整个模块拖走（模块顺序不变）；
 *  - 单击字段只选中（出现高亮框与浮条），不弹就地编辑框；
 *  - 双击字段才弹就地编辑框。
 *
 * 运行前提：另开终端跑 `npm run dev`（默认 5173）。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const BASE = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173'

function log(ok, label, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(`${BASE}/editor`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
for (const sel of ['.ob-skip', '.ob-close']) {
  const el = await page.$(sel)
  if (el) await el.click().catch(() => {})
}
await page.waitForTimeout(400)

const bullet = page.locator('.paper [data-field="bulletText"]').first()
const bulletVisible = await bullet.isVisible().catch(() => false)
log(bulletVisible, '纸面存在可调的要点字段')

if (bulletVisible) {
  const margins = () =>
    bullet.evaluate((el) => {
      const s = getComputedStyle(el)
      return { left: s.marginLeft, top: s.marginTop }
    })

  // 记录模块顺序，验证拖动字段不会把模块整体拖走
  const orderBefore = await page
    .locator('.paper .r-sec[data-sec-id]')
    .evaluateAll((els) => els.map((e) => e.dataset.secId))

  const before = await margins()

  // 按住字段拖动：从字段中心按下，往右 20px、往下 15px
  const box = await bullet.boundingBox()
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 20, startY + 15, { steps: 8 })
  // 拖动途中应有 transform（跟手）
  const midTransform = await bullet.evaluate((el) => el.style.transform)
  log(/translate/.test(midTransform), '拖动途中元素跟手（transform 位移）', midTransform)
  await page.mouse.up()
  await page.waitForTimeout(400)

  const after = await margins()
  log(after.left !== before.left, '右拖增大了左缩进', `${before.left} → ${after.left}`)
  log(after.top !== before.top, '下拖增大了上方间距', `${before.top} → ${after.top}`)

  const resetTransform = await bullet.evaluate((el) => el.style.transform)
  log(resetTransform === '', '松手后 transform 复位（改为内联间距）', resetTransform || '(空)')

  const orderAfter = await page
    .locator('.paper .r-sec[data-sec-id]')
    .evaluateAll((els) => els.map((e) => e.dataset.secId))
  log(
    JSON.stringify(orderBefore) === JSON.stringify(orderAfter),
    '拖动字段不会把模块整体拖走（顺序不变）',
  )

  // 单击 → 选中，出高亮框与浮条，不弹编辑框
  await bullet.click()
  await page.waitForTimeout(300)
  log(await page.locator('.field-box').isVisible().catch(() => false), '单击字段出现高亮框')
  log(await page.locator('.field-nudge').isVisible().catch(() => false), '单击字段出现浮条')
  log(
    !(await page.locator('.ie-box').isVisible().catch(() => false)),
    '单击字段不弹就地编辑框',
  )

  await page.screenshot({ path: 'gui-test-screenshots/field-drag.png' })

  // 双击 → 就地编辑
  await bullet.dblclick()
  await page.waitForTimeout(400)
  log(await page.locator('.ie-box').isVisible().catch(() => false), '双击字段弹出就地编辑框')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

const realErrors = errors.filter((e) => !/favicon|DevTools/i.test(e))
log(realErrors.length === 0, '无运行期 JS 错误', realErrors.slice(0, 2).join(' | '))

await browser.close()
console.log('\n=== 完成 ===')

/**
 * 验证「字段前面的图标跟着字段一起拖」。
 *
 * 求职意向这类 grid 模块里，每个字段是「图标 + 标签：+ 值」。
 * 拖动标签字段时，图标（.r-lab-icon）应作为标签元素的一部分一起移动，
 * 而不是留在原地。这里直接量图标相对标签的偏移在拖动前后是否保持。
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

// 找第一个带图标的 grid 标签字段
const label = page.locator('.paper [data-field="gridLabel"]:has(.r-lab-icon)').first()
const has = await label.count()
log(has > 0, '存在带图标的 grid 标签字段')
if (has > 0) {
  const geom = () =>
    label.evaluate((el) => {
      const icon = el.querySelector('.r-lab-icon')
      const lr = el.getBoundingClientRect()
      const ir = icon ? icon.getBoundingClientRect() : null
      return {
        labelLeft: Math.round(lr.left),
        // 图标相对标签左边框的水平偏移（拖动前后应保持不变 → 证明图标跟着走）
        iconOffset: ir ? Math.round(ir.left - lr.left) : null,
      }
    })

  const before = await geom()
  const box = await label.boundingBox()
  const sx = box.x + box.width / 2
  const sy = box.y + box.height / 2
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + 30, sy, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const after = await geom()

  log(after.labelLeft !== before.labelLeft, '标签被水平拖动了', `${before.labelLeft} → ${after.labelLeft}`)
  log(
    before.iconOffset !== null && after.iconOffset !== null && Math.abs(before.iconOffset - after.iconOffset) <= 1,
    '图标跟着标签一起移动（图标相对标签的偏移不变）',
    `offset ${before.iconOffset} → ${after.iconOffset}`,
  )
  // 拖完标签左移/右移，图标也应在标签内部随动：图标绝对左坐标也变了
  log(true, '截图见 field-icon-drag.png')
  await page.screenshot({ path: 'gui-test-screenshots/field-icon-drag.png' })
}

const realErrors = errors.filter((e) => !/favicon|DevTools/i.test(e))
log(realErrors.length === 0, '无运行期 JS 错误', realErrors.slice(0, 2).join(' | '))
await browser.close()
console.log('\n=== 完成 ===')

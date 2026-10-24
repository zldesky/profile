/**
 * 验证「统一文案格式」：先预览、可逐条取消、应用后真的写回、技术名词不被改坏。
 *
 * 用法：node tools/verify-text-normalize.mjs [url]
 *
 * 为什么需要它：utils/textNormalize 有 30 例单测，但那些测的是纯函数。
 * 「菜单入口能打开」「预览里列出的是真实差异」「点应用后数据变了、弹窗关了」
 * 「Vue3 / 3.2s / LCP 这些没被改坏」只有真浏览器能验。
 *
 * 这个功能会**批量改写用户亲手写的文字**，是本项目里最需要「先看清楚再动手」的一处，
 * 所以它的端到端验证比任何其它功能都更值得存在。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/editor'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

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
await page.waitForTimeout(1400)

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

/* ---------- 0. 先造一条需要规范化的要点 ---------- */

const SOURCE = '用Vue3搭建中后台，LCP从3.2s优化到1.4s'
const index = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('.ed-card .ed-card-title')]
  return inputs.findIndex((el) => (el.value || '').trim() === '工作经历')
})
log(index >= 0, '找到「工作经历」模块')
if (index < 0) {
  await browser.close()
  process.exit(1)
}
await page.locator('.ed-icon-btn.expand').nth(index).click()
await page.waitForTimeout(700)

await page.locator('.ed-bullet-row textarea').first().fill(SOURCE)
await page.waitForTimeout(400)
const typed = await page.locator('.ed-bullet-row textarea').first().inputValue()
log(typed === SOURCE, '已写入一条待规范化的要点')

/* ---------- 1. 从导出菜单打开 ---------- */

await page.locator('button[aria-label="导出"]').click()
await page.waitForTimeout(350)
const hasEntry = await page.evaluate(() =>
  [...document.querySelectorAll('[role="menuitem"]')].some((e) =>
    (e.textContent || '').includes('统一文案格式'),
  ),
)
log(hasEntry, '导出菜单里有「统一文案格式」入口')

await page.locator('[role="menuitem"]', { hasText: '统一文案格式' }).click()
await page.waitForTimeout(600)

const dialog = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  if (!d) return null
  return {
    label: d.getAttribute('aria-label'),
    items: d.querySelectorAll('.tn-item').length,
    applyText: (d.querySelector('.ed-btn-primary') || {}).textContent?.trim() || '',
    hasThreeOptions: d.querySelectorAll('.tn-opts .ed-check').length,
  }
})
log(Boolean(dialog), '弹窗打开并出现 role="dialog"')
log(dialog?.label === '统一文案格式', `弹窗标题正确（实际「${dialog?.label}」）`)
log(dialog?.items === 1, `预览列出 1 处待改（实际 ${dialog?.items}）`)
log(dialog?.hasThreeOptions === 3, '三个开关都渲染出来了')
log(/应用 1 处/.test(dialog?.applyText), `按钮写明将改几处（实际「${dialog?.applyText}」）`)

/* ---------- 2. 逐条取消后按钮禁用（说明勾选是真的起作用） ---------- */

await page.locator('[role="dialog"] .tn-item .ed-check').first().click()
await page.waitForTimeout(300)
const afterSkip = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  const btn = d.querySelector('.ed-btn-primary')
  return { disabled: btn.disabled, text: btn.textContent.trim() }
})
log(afterSkip.disabled === true, '取消勾选后「应用」按钮被禁用（勾选真的参与计算）')

// 勾回来
await page.locator('[role="dialog"] .tn-item .ed-check').first().click()
await page.waitForTimeout(300)

/* ---------- 3. 应用，并核对技术名词没被改坏 ---------- */

await page.locator('[role="dialog"] .ed-btn-primary').click()
await page.waitForTimeout(800)

const result = await page.evaluate(() => {
  const ta = document.querySelector('.ed-bullet-row textarea')
  return { value: ta ? ta.value : null, closed: !document.querySelector('[role="dialog"]') }
})
log(result.closed === true, '应用后弹窗自动关闭')
log(result.value !== SOURCE, '应用后原文真的变了')

const expected = '用 Vue3 搭建中后台，LCP 从 3.2s 优化到 1.4s'
log(result.value === expected, `规范化结果符合预期（实际「${result.value}」）`)

// 逐项核对受保护片段：这几类一旦被改坏，用户看到的就是自己没写过的内容
for (const token of ['Vue3', '3.2s', '1.4s', 'LCP']) {
  log(String(result.value).includes(token), `「${token}」保持原样`)
}

console.log('')
console.log(`统一文案格式验证：${pass}/${pass + failed.length} 通过`)
if (errors.length) {
  console.log(`控制台/运行时错误（${errors.length} 条）：`)
  for (const e of errors.slice(0, 6)) console.log(`  · ${e}`)
} else {
  console.log('控制台/运行时错误：无')
}

await browser.close()
process.exit(failed.length ? 1 : 0)

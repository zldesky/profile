/**
 * 验证右侧内容面板里的拖拽排序：模块卡片能否上下拖动并真的改变顺序。
 * 用法：node tools/verify-drag.mjs
 *
 * 为什么单独验：拖拽是纯交互，静态审计与单测都看不到。
 * 而「拖起来没反应」与「拖了但顺序没变」是两回事，需要分别观察：
 * 前者多为手柄/命中区问题，后者是落点计算问题。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/editor'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 110)}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 110))
})

await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
await page.waitForTimeout(1500)
await page.evaluate(() => {
  const s = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '跳过引导')
  if (s) s.click()
})
await page.waitForTimeout(400)

const order = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.ed-card')].map((c) => c.dataset.sectionId),
  )

const titles = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.ed-card')].map((c) => {
      const t = c.querySelector('[class*="title"], h3, h4')
      const text = (t?.textContent || c.innerText || '').replace(/\s+/g, ' ').trim()
      // 用 id 短码兜底，保证对照可读且唯一
      return (text ? text.slice(0, 10) : '') + '#' + String(c.dataset.sectionId).slice(-4)
    }),
  )

const before = await order()
const beforeTitles = await titles()
console.log('拖拽前后对比（模块卡片）：')
console.log('  拖前顺序: ' + beforeTitles.join(' → '))

// 找第一张卡片上的拖拽手柄
// 先把卡片滚进面板可视区（否则手柄在视口外，鼠标事件落空）
await page.evaluate(() => {
  document.querySelector('.ed-card')?.scrollIntoView({ block: 'start' })
})
await page.waitForTimeout(500)

const handleInfo = await page.evaluate(() => {
  const card = document.querySelector('.ed-card')
  if (!card) return null
  const handle = card.querySelector('[class*="drag"], [class*="handle"], .ed-drag')
  const r = (handle || card).getBoundingClientRect()
  return {
    hasHandle: Boolean(handle),
    handleCls: handle ? handle.className : null,
    x: r.x + r.width / 2,
    y: r.y + r.height / 2,
    cardTop: Math.round(card.getBoundingClientRect().top),
  }
})
console.log('  手柄: ' + (handleInfo?.hasHandle ? `有（${handleInfo.handleCls}）` : '没有（退化到整卡拖拽）'))

if (!handleInfo) {
  console.log('  *** 找不到卡片')
} else {
  // 把第一张拖到第三张的位置
  const targets = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.ed-card')]
    if (cards.length < 3) return null
    const t = cards[2].getBoundingClientRect()
    return { x: t.x + t.width / 2, y: t.y + t.height / 2, count: cards.length }
  })
  if (!targets) {
    console.log(`  *** 卡片不足 3 张（实际 ${before.length}），无法验证换序`)
  } else {
    await page.mouse.move(handleInfo.x, handleInfo.y)
    await page.mouse.down()
    // 分步移动，触发 draggable 的位移判定
    for (let i = 1; i <= 12; i += 1) {
      const y = handleInfo.y + ((targets.y - handleInfo.y) * i) / 12
      await page.mouse.move(handleInfo.x, y)
      await page.waitForTimeout(45)
    }
    await page.waitForTimeout(250)
    await page.mouse.up()
    await page.waitForTimeout(700)

    const after = await order()
    const afterTitles = await titles()
    const changed = JSON.stringify(before) !== JSON.stringify(after)
    console.log('  拖后顺序: ' + afterTitles.join(' → '))
    console.log('  ' + (changed ? '✓ 顺序已改变' : '*** 顺序未变（拖拽未生效）'))
    if (changed) {
      console.log('  新首位: ' + afterTitles[0])
    }
  }
}

console.log('  运行时错误: ' + (errors.length ? errors.join(' | ') : '无'))
await browser.close()
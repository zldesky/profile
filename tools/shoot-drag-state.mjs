/**
 * 一次性截图：拖拽进行中的样子（落点指示线 + 模块跟随）。
 * 用法：node tools/shoot-drag-state.mjs
 *
 * 拖拽的视觉状态没法靠静态截图或文字断言确认 —— 必须按住鼠标、拖到中途再截。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const base = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })

await page.goto(`${base}/editor`, { waitUntil: 'networkidle', timeout: 40000 })
await page.waitForTimeout(1400)
await page.evaluate(() => {
  const s = [...document.querySelectorAll('button')].find(
    (x) => (x.textContent || '').trim() === '跳过引导',
  )
  if (s) s.click()
})
await page.waitForTimeout(500)

const pt = await page.evaluate(() => {
  const secs = [...document.querySelectorAll('.paper .r-sec[data-sec-id]')]
  const a = secs[1]
  a.scrollIntoView({ block: 'center', behavior: 'instant' })
  const ra = a.getBoundingClientRect()
  return { x: ra.left + ra.width / 2, y: ra.top + 10 }
})
await page.evaluate(
  () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
)

// 按住并拖到中途，保持按住状态截图
await page.mouse.move(pt.x, pt.y)
await page.mouse.down()
await page.mouse.move(pt.x, pt.y + 70, { steps: 6 })
await page.waitForTimeout(300)

const state = await page.evaluate(() => {
  const line = document.querySelector('.drop-line')
  const dragging = document.querySelector('.paper.is-sec-dragging')
  return {
    hasLine: Boolean(line),
    lineTop: line ? Math.round(line.getBoundingClientRect().top) : null,
    dragging: Boolean(dragging),
  }
})

await page.screenshot({ path: 'tools/shots/拖拽中.png' })
console.log(`拖拽态=${state.dragging} · 指示线=${state.hasLine ? `有（top=${state.lineTop}）` : '无'}`)
console.log('已截图 tools/shots/拖拽中.png')

await page.keyboard.press('Escape')
await page.mouse.up()
await browser.close()
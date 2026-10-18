/**
 * 打开指定弹窗并截图（用于「看不到界面」时自检）。
 * 用法：node tools/shoot-dialog.mjs <触发按钮文字> [--w 1440] [--out 文件名]
 *
 * 存在的理由：弹窗大多 Teleport 到 body 且需要真实点击才会出现，
 * 静态地看代码或截整页都看不到它们。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const argv = process.argv.slice(2)
const trigger = argv.find((a) => !a.startsWith('--') && !a.startsWith('http'))
const wFlag = argv.indexOf('--w')
const width = wFlag >= 0 ? Number(argv[wFlag + 1]) : 1440
const outFlag = argv.indexOf('--out')
const out = outFlag >= 0 ? argv[outFlag + 1] : `tools/shots/弹窗-${trigger}.png`
const url = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:3001/editor'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width, height: 900 } })
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(900)

// 关掉新手引导，否则挡住一切
await page.evaluate(() => {
  const skip = [...document.querySelectorAll('button')].find(
    (b) => (b.textContent || '').trim() === '跳过引导',
  )
  if (skip) skip.click()
})
await page.waitForTimeout(400)

/** 按可见文字点击 */
async function clickByText(text, { exact = false } = {}) {
  return page.evaluate(
    ({ text, exact }) => {
      const nodes = [...document.querySelectorAll('button, a, [role="menuitem"]')]
      const hit = nodes.find((el) => {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
        if (el.offsetParent === null) return false
        return exact ? t === text : t.includes(text)
      })
      if (!hit) return false
      hit.click()
      return true
    },
    { text, exact },
  )
}

if (trigger) {
  // 二级菜单里的项（如「导入数据」下的「AI 补充导入」）先展开父菜单
  for (const parent of ['导入数据', '导出数据']) {
    await clickByText(parent)
    await page.waitForTimeout(250)
    if (await clickByText(trigger)) break
  }
  if (!(await clickByText(trigger))) {
    // 顶层按钮
    await clickByText(trigger)
  }
  await page.waitForTimeout(900)
}

const shot = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]:not([aria-hidden="true"])')
  if (!dlg) return { found: false }
  const r = dlg.getBoundingClientRect()
  return {
    found: true,
    label: dlg.getAttribute('aria-label') || '',
    size: `${Math.round(r.width)}×${Math.round(r.height)}`,
    text: (dlg.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
  }
})

const { mkdirSync } = await import('node:fs')
mkdirSync('tools/shots', { recursive: true })
await page.screenshot({ path: out })

console.log(`触发「${trigger}」 → ${shot.found ? `弹窗 aria-label=「${shot.label}」 ${shot.size}` : '*** 没找到弹窗 ***'}`)
if (shot.found) console.log(`  内容开头：${shot.text}`)
console.log(`  截图：${out}`)
await browser.close()
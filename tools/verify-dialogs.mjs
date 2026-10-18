/**
 * 逐一验证各弹窗还能打开。
 * 用法：node tools/verify-dialogs.mjs [url]
 *
 * 为什么需要它：弹窗迁 TS 改的是 script 里的类型与收窄写法，**编译不报错、类型也通过**，
 * 但 props / emit 载荷写错、或 ref 收窄改错，弹窗会**打不开或点了没反应** ——
 * 这既不会被单测发现（单测不挂载这些组件），也不会被静态审计发现（弹窗默认不渲染）。
 *
 * 判定：点开触发后 DOM 里必须出现 [role="dialog"]，且它内部有可见文字。
 * 同时记录控制台错误 —— 迁移改坏的运行时问题通常在那里先冒出来。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:3001/editor'

/**
 * 触发方式：先点「先导按钮」展开菜单，再点目标项。
 * 文案取自界面本身，改动了文案这里会同时失效（那正是我们要知道的）。
 */
const TARGETS = [
  { name: '简历体检', trigger: '简历体检' },
  { name: 'JD 匹配', trigger: 'JD 匹配' },
  { name: '我的简历', trigger: '我的简历' },
  { name: 'AI 设置', menu: '导入数据', trigger: 'AI 补充导入' },
  { name: '快捷键', press: '?' },
]

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 120)}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 120))
})

await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
await page.waitForTimeout(1000)
await page.evaluate(() => {
  const s = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '跳过引导')
  if (s) s.click()
})
await page.waitForTimeout(400)

const clickText = (text) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll('button, a, [role="menuitem"], [role="tab"]')].find(
      (x) => (x.textContent || '').replace(/\s+/g, ' ').trim().includes(t) && x.offsetParent !== null,
    )
    if (!el) return false
    el.click()
    return true
  }, text)

const dialogState = () =>
  page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    if (!d) return null
    return {
      label: d.getAttribute('aria-label') || '(无 label)',
      chars: (d.innerText || '').replace(/\s+/g, '').length,
      size: (() => {
        const r = d.getBoundingClientRect()
        return `${Math.round(r.width)}×${Math.round(r.height)}`
      })(),
    }
  })

let pass = 0
const failed = []

for (const t of TARGETS) {
  // 先关掉可能还开着的弹窗
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)

  let opened
  if (t.press) {
    await page.keyboard.press(t.press)
    opened = true
  } else {
    if (t.menu) {
      await clickText(t.menu)
      await page.waitForTimeout(250)
    }
    opened = await clickText(t.trigger)
  }
  await page.waitForTimeout(700)

  const state = await dialogState()
  const ok = opened && state && state.chars > 0
  if (ok) {
    pass += 1
    console.log(`  ✓ ${t.name.padEnd(10)} aria-label=「${state.label}」 ${state.size} · ${state.chars} 字`)
  } else {
    failed.push(t.name)
    console.log(
      `  *** 失败 *** ${t.name}  触发=${opened} 弹窗=${state ? JSON.stringify(state) : '未出现'}`,
    )
  }
}

console.log('')
console.log(`弹窗验证：${pass}/${TARGETS.length} 通过`)
if (errors.length) {
  console.log(`控制台/运行时错误（${errors.length} 条）：`)
  for (const e of errors.slice(0, 6)) console.log(`  · ${e}`)
} else {
  console.log('控制台/运行时错误：无')
}

await browser.close()
process.exit(failed.length ? 1 : 0)
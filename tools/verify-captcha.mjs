/**
 * 验证滑块验证码（SliderCaptcha）在注册流程里能正常加载与拖动。
 * 用法：node tools/verify-captcha.mjs [base]
 *
 * 为什么单独验它：滑块是**注册的必经环节**，它坏了用户就注册不了 ——
 * 而它是个拖拽状态机，迁 TS 时最容易在收窄 / 事件参数上改错。
 * 静态审计看不到（它默认不渲染），单测也不挂载这个组件。
 *
 * 判定两件事：1）挑战图与滑块渲染出来；2）真的能拖动（位置发生变化）。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const base = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:3001'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 110)}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 110))
})

await page.goto(`${base}/login`, { waitUntil: 'networkidle', timeout: 40000 })
await page.waitForTimeout(800)

// 切到「注册」页签 —— 滑块只在注册流程里出现
const switched = await page.evaluate(() => {
  const tab = [...document.querySelectorAll('button, [role="tab"]')].find(
    (x) => (x.textContent || '').trim() === '注册',
  )
  if (!tab) return false
  tab.click()
  return true
})
await page.waitForTimeout(400)

/*
 * 滑块**不是切页签就出现**：它在点「注册」提交后才弹（AuthPanel 里
 * `if (mode === 'register' && !captchaToken) captchaOpen = true`）。
 * 第一版只切了页签就去找元素，于是报「未通过」—— 那是**探针的错**，
 * 不是滑块的错。所以这里补上「填表 + 点注册」。
 */
const submitted = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input')]
  const user = inputs.find((i) => /用户名/.test(i.placeholder || '') || i.type === 'text')
  const pass = inputs.find((i) => i.type === 'password')
  if (!user || !pass) return false
  // 用唯一用户名，避免撞到已存在的账号
  const set = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  set(user, 'captcha_probe_' + Date.now().toString(36))
  set(pass, 'password123')
  /*
   * 提交按钮的文案是「注册并登录」，而页签也叫「注册」——
   * 第一版用精确匹配 '注册'，命中的是那个**页签**，提交按钮从未被点到，
   * 于是报「滑块未通过」，实际是探针没点到。这里改为包含匹配并优先取非页签的按钮，
   * 同时把实际点到的文案回传出来，避免同类静默失手再来一次。
   */
  const btn = [...document.querySelectorAll('button')]
    .filter((b) => /注册/.test((b.textContent || '').trim()))
    .find((b) => !b.closest('.auth-tabs, [role="tablist"], .panel-tabs'))
  if (!btn) return { ok: false, label: null }
  const label = (btn.textContent || '').trim()
  btn.click()
  return { ok: true, label }
})
await page.waitForTimeout(1600)

// 找挑战图：服务端下发的是 data:image/svg+xml 的 SVG
const loaded = await page.evaluate(() => {
  const svgImgs = [...document.querySelectorAll('img')].filter((i) =>
    (i.getAttribute('src') || '').startsWith('data:image/svg'),
  )
  const handle = document.querySelector('.slider-captcha [class*="sc-"][class*="handle"], .slider-captcha .sc-handle, .slider-captcha [class*="knob"]')
  const text = document.body.innerText
  return {
    challengeImgs: svgImgs.length,
    hasHandle: Boolean(handle),
    handleCls: handle ? handle.className : null,
    hint: (text.match(/按住滑块[^\n]*/) || text.match(/加载中[^\n]*/) || ['(无提示)'])[0],
  }
})

console.log(`切到注册页签: ${switched} · 提交注册表单: ${submitted.ok}（点到「${submitted.label}」）`)
console.log(`挑战图数量  : ${loaded.challengeImgs}`)
console.log(`滑块手柄    : ${loaded.hasHandle}${loaded.handleCls ? ` (${loaded.handleCls})` : ''}`)
console.log(`提示文案    : ${loaded.hint}`)

// 试着拖一下手柄，看位置是否真的变化
let dragged
const handle = page.locator('.slider-captcha [class*="handle"], .slider-captcha [class*="knob"]').first()
if (await handle.count()) {
  const box = await handle.boundingBox()
  if (box) {
    const before = box.x
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 12 })
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => {
      const h = document.querySelector('.slider-captcha [class*="handle"], .slider-captcha [class*="knob"]')
      return h ? Math.round(h.getBoundingClientRect().x) : null
    })
    await page.mouse.up()
    dragged = after === null ? '取不到位置' : `${Math.round(before)} → ${after}  ${after > before ? '已移动' : '*** 未移动 ***'}`
  } else {
    dragged = '拿不到手柄坐标'
  }
} else {
  dragged = '未找到手柄元素'
}
console.log(`拖动测试    : ${dragged}`)
console.log(`运行时错误  : ${errors.length ? errors.join(' | ') : '无'}`)

const ok = loaded.challengeImgs >= 1 && loaded.hasHandle && /已移动/.test(dragged) && !errors.length
console.log('')
console.log(ok ? '滑块验证：通过' : '滑块验证：*** 未通过 ***')

await browser.close()
process.exit(ok ? 0 : 1)
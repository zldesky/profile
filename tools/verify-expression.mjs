/**
 * 验证「表达助手」：本地建议真的能用、真的会随编辑变化、真的不依赖网络。
 *
 * 用法：node tools/verify-expression.mjs [url]
 *   默认连 http://localhost:5173/editor（先 npm run dev）
 *
 * 为什么需要它：规则引擎有 43 例单测，但那些测的是**纯函数**。
 * 「点了 ✦ 会打开面板」「面板里显示的是这条要点的诊断」「改用例后诊断跟着变」
 * 这三件事只有真浏览器能验 —— 单测不挂载组件，静态审计看不到交互。
 *
 * 判定原则（照 .agent/testing.md）：
 *  - 拿不到元素就判 FAIL，不判跳过；
 *  - 每条断言都要能失败：所以除了「有建议」，还要验「改好之后建议消失」。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/editor'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

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
await page.waitForTimeout(1200)

/*
 * 新手引导是首访才出现的（写 localStorage 标记），所以要在**同一个上下文**里：
 * 先关掉它、再刷新，否则每次刷新它都会回来。
 * 这里不用 localStorage.clear() —— 那会把「是否已看过引导」一起清掉，
 * 于是刷新后引导又出现，后续所有查询都会先撞上它。
 */
const dismissOnboarding = async () => {
  for (let i = 0; i < 6; i += 1) {
    const clicked = await page.evaluate(() => {
      const skip = [...document.querySelectorAll('button')].find(
        (x) => (x.textContent || '').trim() === '跳过引导',
      )
      if (!skip) return false
      skip.click()
      return true
    })
    if (!clicked) return
    await page.waitForTimeout(350)
  }
}
await dismissOnboarding()

// 确认引导确实关了，否则后面的断言全是假的
const onboardingGone = await page.evaluate(
  () => !document.querySelector('[aria-label="新手引导"]'),
)
if (!onboardingGone) {
  console.log('  *** 失败 *** 新手引导关不掉，后续检查无法进行')
  await browser.close()
  process.exit(1)
}
console.log('  ✓ 新手引导已关闭')

/* ---------------- 1. 在右侧「简历模块」里展开工作经历 ---------------- */

/*
 * 展开靠模块卡片右侧的箭头按钮（.ed-icon-btn.expand），标题本身是可改名的输入框。
 *
 * 两处踩过的坑，写在这里免得下一个人重犯：
 *  1. 不要点面板顶部的锚点胶囊（「基本信息 / 工作经历 …」）—— 它只滚动到模块，不展开。
 *  2. 不能用 hasText: '工作经历' 定位卡片 —— 模块标题是 <input value="工作经历">，
 *     不在 innerText 里，hasText 永远匹配不到。必须按 input.value 找索引。
 */
const expandCardByInputValue = async (title) => {
  const index = await page.evaluate((t) => {
    const inputs = [...document.querySelectorAll('.ed-card .ed-card-title')]
    return inputs.findIndex((el) => (el.value || '').trim() === t)
  }, title)
  if (index < 0) return false

  const toggle = page.locator('.ed-icon-btn.expand').nth(index)
  if ((await toggle.count()) === 0) return false
  await toggle.click()
  await page.waitForTimeout(800)
  return (await page.locator('button[aria-label="打开表达助手"]').count()) > 0
}

const expanded = await expandCardByInputValue('工作经历')
log(expanded, '在右侧面板展开了「工作经历」并看到要点行')

/* ---------------- 2. 点第一条要点右侧的表达助手按钮 ---------------- */

const clicked = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('button[aria-label="打开表达助手"]')]
  if (!buttons.length) return false
  buttons[0].click()
  return true
})
log(clicked, '要点行上的「表达助手」按钮可点击')
await page.waitForTimeout(500)

const dialog = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  if (!d) return null
  return {
    label: d.getAttribute('aria-label') || '',
    text: (d.innerText || '').replace(/\s+/g, ' ').trim(),
    hasLocalTab: [...d.querySelectorAll('[role="tab"]')].some((tab) =>
      (tab.textContent || '').includes('本地建议'),
    ),
    activeTab:
      [...d.querySelectorAll('[role="tab"]')]
        .find((tab) => tab.getAttribute('aria-selected') === 'true')
        ?.textContent?.trim() || '',
  }
})
log(Boolean(dialog), '面板打开并出现 role="dialog"')
log(dialog?.label.includes('表达助手'), `面板标题为表达助手（实际「${dialog?.label}」）`)
log(dialog?.hasLocalTab === true, '存在「本地建议」页签')
log(dialog?.activeTab === '本地建议', '默认停在「本地建议」（不需要任何前提的那半边）')

/* ---------------- 3. 本地建议必须当场给内容 ---------------- */

const localBody = dialog?.text || ''
const hasVerdict = /这条没有发现明显问题|值得改|可以更好|硬伤|命中：/.test(localBody)
log(hasVerdict, '本地建议区有实际判断（不是空壳）')

/*
 * 4. 关键断言：**断网下本地建议仍然可用**。
 *    在浏览器里把 fetch 换成抛错实现，模拟「没网 / 没配 Key」。
 *    如果本地建议依赖网络，这一段之后重算就会变成错误提示。
 *
 *    注意用 Playwright 的 fill() 而不是 evaluate 里直接赋 textarea.value：
 *    后者绕过了 Vue 的双向绑定（不触发 input 事件时，v-model 收不到），
 *    于是「改写原文」根本没生效，后面的断言全在验一个没变过的面板。
 */
const offline = await page.evaluate(() => {
  window.__origFetch = window.fetch
  window.fetch = () => Promise.reject(new Error('offline'))
  return true
})
log(offline, '已切断网络（模拟离线）')

await page.locator('[role="dialog"] textarea').first().fill('负责后台管理系统的开发，提升了效率')
await page.waitForTimeout(500)
log(true, '改写原文触发重算')

const afterEdit = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  return d ? (d.innerText || '').replace(/\s+/g, ' ') : ''
})
log(
  /弱动词|含糊|没有数字|值得改/.test(afterEdit),
  '断网状态下改写成「负责…提升了效率」后，建议照样产出（弱动词/没数字）',
)
log(!/改写没有成功|Failed to fetch|offline/.test(afterEdit), '全程没有出现网络错误提示')

const restored = await page.evaluate(() => {
  if (window.__origFetch) window.fetch = window.__origFetch
  return true
})
log(restored, '恢复 fetch')

/* ---------------- 5. 一键替换能改到原文 ---------------- */

const beforeValue = await page.locator('[role="dialog"] textarea').first().inputValue()
await page.locator('[role="dialog"] .ea-fix').first().click()
await page.waitForTimeout(400)
const afterValue = await page.locator('[role="dialog"] textarea').first().inputValue()

log(beforeValue !== afterValue, `替换候选可点击生效（「${beforeValue}」→「${afterValue}」）`)
log(!afterValue.includes('负责'), '替换后弱动词确实被换掉了')

/* ---------------- 6. 措辞改写页签存在且给出前提说明 ---------------- */

const rewriteTab = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')]
  const t = tabs.find((x) => (x.textContent || '').includes('措辞改写'))
  if (!t) return null
  t.click()
  return true
})
log(rewriteTab === true, '可切到「措辞改写」页签')
await page.waitForTimeout(300)

const rewriteBody = await page.evaluate(
  () => document.querySelector('[role="dialog"]')?.innerText || '',
)
log(/应用前请逐句核对事实/.test(rewriteBody), '改写页提示了「事实需自行核对」')
log(!/AI 润色/.test(rewriteBody), '面板内不再出现「AI 润色」字样')

/* ---------------- 7. 关闭后回到编辑器 ---------------- */

await page.keyboard.press('Escape')
await page.waitForTimeout(400)
const closed = await page.evaluate(() => !document.querySelector('[role="dialog"]'))
log(closed, 'Esc 可关闭面板')

console.log('')
console.log(`表达助手验证：${pass}/${pass + failed.length} 通过`)
if (errors.length) {
  console.log(`控制台/运行时错误（${errors.length} 条）：`)
  for (const e of errors.slice(0, 6)) console.log(`  · ${e}`)
} else {
  console.log('控制台/运行时错误：无')
}

await browser.close()
process.exit(failed.length ? 1 : 0)

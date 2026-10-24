/**
 * 验证「模型服务设置」里的 Key 申请直达链接。
 *
 * 用法：node tools/verify-key-link.mjs [url]
 *
 * 为什么需要它：这条链接的价值全在「能点过去」。
 * tests/aiKeyStore.test.js 只断言了数据形状（https、无查询参数），
 * 但断言不了「弹窗里真的渲染出来了」「切换服务商时链接跟着变」「href 与预设一致」。
 * 而这三点任一失效，用户看到的就是「点了没反应」——
 * 不报错、不抛异常，只是白点一次。
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

/* ---------- 打开设置弹窗（走真实入口：表达助手 → 措辞改写 → 去设置） ---------- */

const index = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('.ed-card .ed-card-title')]
  return inputs.findIndex((el) => (el.value || '').trim() === '工作经历')
})
await page.locator('.ed-icon-btn.expand').nth(index).click()
await page.waitForTimeout(600)
await page.locator('button[aria-label="打开表达助手"]').first().click()
await page.waitForTimeout(600)
await page.locator('[role="tab"]', { hasText: '措辞改写' }).click()
await page.waitForTimeout(400)

const opened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) =>
    (b.textContent || '').includes('去设置'),
  )
  if (!btn) return false
  btn.click()
  return true
})
log(opened, '从表达助手进入「模型服务设置」')
await page.waitForTimeout(700)

/** 读当前设置弹窗里与 Key 链接有关的一切 */
const readDialog = () =>
  page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    const d = dialogs[dialogs.length - 1]
    if (!d) return null
    const link = d.querySelector('.ai-keylink-a')
    return {
      title: (d.querySelector('.ai-title') || {}).textContent || '',
      hasLink: Boolean(link),
      href: link?.getAttribute('href') ?? null,
      target: link?.getAttribute('target') ?? null,
      rel: link?.getAttribute('rel') ?? null,
      note: (d.querySelector('.ai-keylink span') || {}).textContent || '',
      linkText: (link?.textContent || '').trim(),
      presetLabel: (d.querySelector('.bsel') || {}).textContent || '',
    }
  })

const first = await readDialog()
log(first?.title === '模型服务设置', `弹窗标题为「模型服务设置」（实际「${first?.title}」）`)
log(first?.hasLink === true, '出现「去拿 Key」链接')
log(
  first?.href?.startsWith('https://') === true,
  `链接是 https 绝对地址（实际「${first?.href}」）`,
)
log(first?.target === '_blank', '在新标签页打开（不打断当前编辑）')
// noreferrer 是必需的：否则外部站点能拿到本应用地址
log(
  /noopener/.test(first?.rel || '') && /noreferrer/.test(first?.rel || ''),
  `rel 含 noopener 与 noreferrer（实际「${first?.rel}」）`,
)
log(first?.linkText?.includes('去拿 Key') === true, '链接文案说明它是干什么的')
log((first?.note || '').length > 0, `显示了额度提示（「${first?.note}」）`)

/* ---------- 切换服务商：链接必须跟着变 ---------- */

/*
 * BaseSelect 内部是**原生 <select>**（见 BaseSelect.vue：<option v-for>），
 * 不是自绘浮层。所以要用 Playwright 的 selectOption，而不是「点开浮层再点选项」。
 *
 * 第一版就是按浮层写的，选择器一个都匹配不到 —— 与 PITFALLS A9「隐藏元素」同族：
 * 先确认那个控件到底是什么，再决定怎么操作。
 */
const presetSelect = page.locator('[role="dialog"] select').first()
const selectCount = await presetSelect.count()
log(selectCount > 0, `服务商是原生 select（找到 ${selectCount} 个）`)

await presetSelect.selectOption('glm')
await page.waitForTimeout(500)

const afterSwitch = await readDialog()
log(
  afterSwitch?.href !== first?.href,
  `切换服务商后链接跟着变（${first?.href} → ${afterSwitch?.href}）`,
)
log(
  afterSwitch?.href?.includes('bigmodel.cn') === true,
  `新链接指向智谱（实际「${afterSwitch?.href}」）`,
)
// 智谱的 glm-4-flash 长期免费，这条提示对「想零成本试用」的用户最关键
log(
  /免费/.test(afterSwitch?.note || ''),
  `智谱这条如实标了免费（「${afterSwitch?.note}」）`,
)

/* ---------- 「自定义」不该有链接（没有统一入口） ---------- */

await presetSelect.selectOption('custom')
await page.waitForTimeout(500)

const customState = await readDialog()
log(
  customState?.hasLink === false,
  '选「自定义」时不显示链接（没有统一入口，硬给一个只会误导）',
)

console.log('')
console.log(`Key 链接验证：${pass}/${pass + failed.length} 通过`)
if (errors.length) {
  console.log(`控制台/运行时错误（${errors.length} 条）：`)
  for (const e of errors.slice(0, 6)) console.log(`  · ${e}`)
} else {
  console.log('控制台/运行时错误：无')
}

await browser.close()
process.exit(failed.length ? 1 : 0)

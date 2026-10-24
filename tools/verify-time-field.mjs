/**
 * 验证时间选择器：结构化 / 自由写法 / 至今 三条路都能走通，且纸面跟着变。
 *
 * 用法：node tools/verify-time-field.mjs [url]
 *   默认连 http://localhost:5173/editor（先 npm run dev）
 *
 * 为什么需要它：utils/entryTime 有 32 例单测，但那些测的是纯函数。
 * 「选择器真的渲染成两个年月下拉」「勾选至今会让结束时间消失」「改动会写回数据并反映到纸面」
 * 只有真浏览器能验。这个组件替换掉了原来那个自由文本框，
 * 一旦它的 emit 载荷接错，用户会**看起来能选、实际什么都没存**——那正是最该被自动化盯住的形态。
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
await page.waitForTimeout(1300)

// 关掉首访引导，并确认真的关掉了（否则后面的 role=dialog 查询会撞上它）
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
log(
  await page.evaluate(() => !document.querySelector('[aria-label="新手引导"]')),
  '新手引导已关闭',
)

/** 展开某个模块（标题是 input.value，不在 innerText 里，不能用 hasText） */
const expandCard = async (title) => {
  const index = await page.evaluate((t) => {
    const inputs = [...document.querySelectorAll('.ed-card .ed-card-title')]
    return inputs.findIndex((el) => (el.value || '').trim() === t)
  }, title)
  if (index < 0) return false
  await page.locator('.ed-icon-btn.expand').nth(index).click()
  await page.waitForTimeout(700)
  return (await page.locator('.et-wrap').count()) > 0
}

log(await expandCard('工作经历'), '展开「工作经历」后出现时间控件')

const first = page.locator('.et-wrap').first()

/* ---------- 1. 结构化：预填成两个年月下拉 ---------- */

const initial = await page.evaluate(() => {
  const wrap = document.querySelector('.et-wrap')
  return {
    selects: wrap.querySelectorAll('.et-select').length,
    tags: [...wrap.querySelectorAll('.et-tag')].map((t) => t.textContent.trim()),
    ongoing: Boolean(wrap.querySelector('.et-ongoing')),
  }
})
/*
 * 断言用「至今时 2 个、非至今时 4 个」而不是一律 4 个。
 * 第一版写成「恒等于 4」，在「至今」状态下必然红 —— 那是断言写错了，
 * 因为「至今」本来就没有结束年月可填。这类断言必须跟着真实语义走。
 */
log(
  initial.selects === 2 && initial.ongoing,
  `「至今」状态下只渲染开始年月 2 个（实际 ${initial.selects}）`,
)
log(
  initial.tags.join('/') === '开始/结束',
  `两行标签为「开始 / 结束」（实际 ${initial.tags.join('/')}）`,
)
log(initial.ongoing === true, '「至今」的经历显示为文字而不是结束时间选择器')

/* ---------- 2. 取消「至今」→ 结束时间出现，纸面不再显示「至今」 ---------- */

const paperBefore = await page.evaluate(() => document.body.innerText.includes('2022-06 - 至今'))
log(paperBefore, '初始纸面显示「2022-06 - 至今」')

await first.locator('.et-check input').click()
await page.waitForTimeout(500)

const afterUncheck = await page.evaluate(() => {
  const wrap = document.querySelector('.et-wrap')
  return {
    ongoing: Boolean(wrap.querySelector('.et-ongoing')),
    selects: wrap.querySelectorAll('.et-select').length,
    paperStillOngoing: document.body.innerText.includes('2022-06 - 至今'),
  }
})
log(afterUncheck.ongoing === false, '取消「至今」后结束时间选择器出现')
log(afterUncheck.paperStillOngoing === false, '纸面不再显示「至今」（说明改动真的写回了数据）')

/* ---------- 3. 勾回「至今」→ 回到原状（往返一致） ---------- */

await first.locator('.et-check input').click()
await page.waitForTimeout(500)
const backAgain = await page.evaluate(() => document.body.innerText.includes('2022-06 - 至今'))
log(backAgain === true, '重新勾选「至今」后纸面恢复为「2022-06 - 至今」')

/* ---------- 4. 自由写法：原样保留，不被强行改写 ---------- */

const freeform = await page.evaluate(async () => {
  const wrap = document.querySelector('.et-wrap')
  const link = [...wrap.querySelectorAll('.et-link')].find(
    (b) => (b.textContent || '').trim() === '自由填写',
  )
  if (!link) return null
  link.click()
  return true
})
log(freeform === true, '「自由填写」入口可点击')
await page.waitForTimeout(400)

const freeformState = await page.evaluate(() => {
  const wrap = document.querySelector('.et-wrap')
  const input = wrap.querySelector('input.ed-input')
  return { hasInput: Boolean(input), value: input ? input.value : null }
})
log(freeformState.hasInput === true, '切到自由填写后出现文本框')

// 写一个解析不出来的时间，确认它保留了原文、没有被改成月份
if (freeformState.hasInput) {
  await first.locator('input.ed-input').fill('大学期间')
  await page.waitForTimeout(500)
  const kept = await page.evaluate(() => {
    const wrap = document.querySelector('.et-wrap')
    const input = wrap.querySelector('input.ed-input')
    return {
      stillInput: Boolean(input),
      value: input ? input.value : null,
      paperHasIt: document.body.innerText.includes('大学期间'),
    }
  })
  log(kept.stillInput === true && kept.value === '大学期间', '「大学期间」原样保留在文本框里')
  log(kept.paperHasIt === true, '「大学期间」原样出现在纸面上（没有被改写成月份）')
}

console.log('')
console.log(`时间控件验证：${pass}/${pass + failed.length} 通过`)
if (errors.length) {
  console.log(`控制台/运行时错误（${errors.length} 条）：`)
  for (const e of errors.slice(0, 6)) console.log(`  · ${e}`)
} else {
  console.log('控制台/运行时错误：无')
}

await browser.close()
process.exit(failed.length ? 1 : 0)

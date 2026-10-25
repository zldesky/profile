/**
 * 验证「简历模块」常用模块下拉不再列出简历里已有的模块。
 * 用法：node tools/verify-preset-filter.mjs [url]（默认 http://localhost:5173/editor）
 *
 * 为什么要有它：过滤逻辑在 computed 里，类型检查 / build 全绿也挡不住
 * 「过滤条件写错字段、标题比对永远不命中」这类静默失效；而 IAB 的合成点击
 * 派发不到页面（见 .zcode 记忆 gui-testing-traps-iab），交互断言必须在
 * 真实 Edge（playwright-core + channel: 'msedge'）里做。
 *
 * 判定：
 *  1. 打开下拉，选项里没有任何一个与已有模块标题相同的项；
 *  2. 选中一个加进简历后，该项立即从下拉里消失，且当前值自动挪到下一个可选预设；
 *  3. 把模块删掉后（Ctrl+Z 同款路径走删除按钮 + 确认弹窗），该项重新回到下拉里；
 *  4. 「添加空白模块」下拉不受影响（自定义类型始终可选）。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'

const url = process.argv[2] || 'http://localhost:5173/editor'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bsel-trigger')

/* 首次访问会弹新手引导遮罩（ob-mask 挡住一切点击），先跳过 */
const skipOnboarding = page.getByRole('button', { name: '跳过引导' })
if (await skipOnboarding.count()) await skipOnboarding.click()
await page.waitForTimeout(200)

/** 常用模块 / 空白模块下拉都靠 aria-label 定位（页面上下拉数量随数据变化，不能数序） */
const presetTrigger = page.getByRole('combobox', { name: '选择要添加的常用模块' })
const customTrigger = page.getByRole('combobox', { name: '选择空白模块类型' })
const menu = page.locator('.bsel-menu')

/**
 * 点开一个 BaseSelect：先滚动到位等滚动停稳，再点。
 *
 * 直接 click 会踩一个很隐蔽的坑：Playwright 点击前的 scrollIntoViewIfNeeded
 * 触发的 panel-body 滚动事件会持续到点击之后几十毫秒，而 BaseSelect 是
 * 「打开后遇滚动即关闭」（对齐原生 select），于是菜单开了又立刻被关，
 * 表现为「点了没反应」。真实用户滚轮到位后再点不会遇到。
 */
async function openSelect(trigger) {
  await trigger.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  await trigger.click()
  await menu.waitFor({ state: 'visible' })
}

/** 点开常用模块下拉，返回当前菜单里的选项文本数组 */
async function openAndReadOptions() {
  await openSelect(presetTrigger)
  const labels = await menu.locator('.bsel-option').allTextContents()
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  return labels.map((s) => s.trim())
}

const failures = []
function check(name, ok, detail = '') {
  if (ok) console.log(`  ✓ ${name}`)
  else (failures.push(name), console.log(`  ✗ ${name} ${detail}`))
}

/* 已有模块标题直接从模块卡片读，不写死 —— 预置数据变了测试也不误报 */
const cardInputs = await page.locator('.ed-card input.ed-card-title').all()
const titles = []
for (const input of cardInputs) titles.push(await input.inputValue())
console.log(`编辑面板已有模块：${titles.join('、')}`)

const options = await openAndReadOptions()
console.log(`下拉选项：${options.join('、')}`)

check(
  '1. 已有模块都不在下拉里',
  titles.every((t) => !options.includes(t)),
)
check('1b. 选项确实被过滤变少了', options.length > 0 && options.length < 11)

/* 加一个再验：选中第一个选项 → 点「添加」→ 模块加入简历 → 再开下拉它应消失。
 * 注意下拉只负责选预设，真正入列要点旁边的「添加」按钮。 */
const chosen = options[0]
await openSelect(presetTrigger)
await menu.locator('.bsel-option', { hasText: chosen }).click()
await page.getByRole('button', { name: '添加', exact: true }).click()
await page.waitForTimeout(300)

const titlesAfterAdd = await page.locator('.ed-card input.ed-card-title').all()
const added = []
for (const input of titlesAfterAdd) added.push(await input.inputValue())
check('2. 添加后模块数 +1 且标题正确', added.length === titles.length + 1 && added.includes(chosen))

const optionsAfter = await openAndReadOptions()
check('2b. 刚添加的模块从下拉消失', !optionsAfter.includes(chosen), `选项仍有 ${chosen}`)
const currentValue = await presetTrigger.textContent()
check(
  '2c. 当前值自动挪到下一个可选预设',
  optionsAfter.some((o) => currentValue.includes(o.trim())),
)

/* 删掉刚加的模块（新模块加入时会自动展开，删除按钮直接可见；走确认弹窗） */
const delBtn = page.locator('.ed-card').last().getByTitle('删除该模块')
if ((await delBtn.count()) === 1) {
  await delBtn.click()
  const confirm = page.getByRole('button', { name: '删除', exact: true })
  await confirm.click()
  await page.waitForTimeout(300)
  const optionsRestored = await openAndReadOptions()
  check('3. 删除后模块回到下拉里', optionsRestored.includes(chosen))
} else {
  failures.push('找不到删除按钮，第 3 步没跑')
  console.log('  ✗ 找不到删除按钮，第 3 步没跑')
}

/* 空白模块下拉不受影响 */
await openSelect(customTrigger)
const customCount = await menu.locator('.bsel-option').count()
await page.keyboard.press('Escape')
check('4. 空白模块下拉仍有 4 个类型可选', customCount === 4, `实际 ${customCount}`)

await browser.close()

if (failures.length) {
  console.error(`\n失败 ${failures.length} 项：${failures.join('；')}`)
  process.exit(1)
}
console.log('\n全部通过')

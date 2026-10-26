/**
 * 验证纸面就地编辑的「选中文字标粗」：加粗 / 取消加粗 / 快捷键 / 不可加粗字段四条路。
 *
 * 用法：node tools/verify-bold.mjs [url]
 *   默认连 http://localhost:5173/editor（先 npm run dev）
 * 可选 SHOT_DIR=<目录> 顺手截图（与其他 verify 脚本一致）。
 *
 * 为什么需要它：加粗链路跨四个文件（richText 纯函数 / RichText 渲染 / InlineEditor
 * 的选区同步 / exporters 的纯文本剥离），单测只覆盖纯函数那一段。
 * 「选区事件真的让按钮出现」「按钮点击不丢输入框焦点」「Enter(Ctrl+Enter) 后纸面
 * 渲染出 strong 且没有字面星号」只有真浏览器能验 —— 任何一环接错，用户看到的都是
 * 「选了、点了、没反应」。
 *
 * 注意：脚本会就地编辑当前文档的**第一条要点**（最后一步恢复原样）；
 * 中途失败时文档可能残留加粗，可用 Ctrl+Z 撤销。
 */
import { chromium } from '../server/node_modules/playwright-core/index.mjs'
import { mkdirSync } from 'node:fs'
import { join as pathJoin } from 'node:path'

const url = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/editor'
const shotDir = process.env.SHOT_DIR

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
    console.log(`  [ok] ${message}`)
  } else {
    failed.push(message)
    console.log(`  *** 失败 *** ${message}`)
  }
}
const shot = async (name) => {
  if (!shotDir) return
  mkdirSync(shotDir, { recursive: true })
  await page.screenshot({ path: pathJoin(shotDir, name) })
}

await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
await page.waitForTimeout(1300)

// 关掉首访引导（与 verify-time-field 相同的循环：确认真的关掉了才继续）
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

const firstBullet = page.locator('.paper li[data-field="bulletText"]').first()

/* ---------- 0. 预清理：上次运行若残留加粗，先把第一条要点还原成纯文本 ---------- */

await firstBullet.click()
await page.waitForTimeout(500)
{
  const iePre = page.locator('.ie-input')
  const raw = await iePre.inputValue()
  if (raw.includes('**')) {
    await iePre.fill(raw.replace(/\*\*([^*]+)\*\*/g, '$1'))
    await iePre.press('Control+Enter')
    await page.waitForTimeout(600)
    console.log('  [ok] 清理了上次运行残留的加粗标记')
  } else {
    await iePre.press('Escape')
    await page.waitForTimeout(300)
  }
}

/* ---------- 1. 单击要点打开就地编辑 ---------- */

await firstBullet.click()
await page.waitForTimeout(500)

const ie = page.locator('.ie-input')
log((await ie.count()) === 1, '单击要点后出现就地编辑输入框')

const raw0 = await ie.inputValue()
log(!raw0.includes('**'), `被测要点初始不含加粗标记（前 12 字：${raw0.slice(0, 12)}…）`)
log((await ie.inputValue()) === raw0, '输入框值与纸面文字一致')

/* ---------- 2. 选中开头 4 个字 → 按钮出现 → 点 B 加粗 ---------- */

// 打开时默认全选；Home 收起光标到行首，再向右扩展出一段精确选区
await ie.press('Home')
for (let i = 0; i < 4; i += 1) await ie.press('Shift+ArrowRight')
await page.waitForTimeout(300)

const btn = page.locator('.ie-bold')
log((await btn.count()) === 1, '框内有选中时浮出加粗按钮')
// 按钮的可读文案在 aria-label 里，textContent 固定为字形「B」
const btnLabel = async () => (await btn.getAttribute('aria-label'))?.trim()
log((await btnLabel()) === '加粗', '未加粗状态下按钮文案为「加粗」')
await shot('bold-1-toolbar.png')

await btn.click()
await page.waitForTimeout(300)

const afterBold = await ie.inputValue()
log(
  afterBold === `**${raw0.slice(0, 4)}**${raw0.slice(4)}`,
  '点 B 后草稿在选区两侧写入 **（选区其余部分不动）',
)
log((await btnLabel()) === '取消加粗', '选区已在粗体内，按钮翻转为「取消加粗」')
await shot('bold-2-applied.png')

/* ---------- 3. Ctrl+Enter 提交 → 纸面渲染出 strong、无字面星号 ---------- */

await ie.press('Control+Enter')
await page.waitForTimeout(600)

const paperAfterBold = await page.evaluate(() => {
  const li = document.querySelector('.paper li[data-field="bulletText"]')
  return {
    strong: li?.querySelector('strong')?.textContent || null,
    text: li?.textContent ?? '',
  }
})
log(
  paperAfterBold.strong === raw0.slice(0, 4),
  `纸面渲染出 <strong>（内容「${paperAfterBold.strong}」）`,
)
log(!paperAfterBold.text.includes('**'), '纸面文字不含字面 **（标记只存在于数据里）')
await shot('bold-3-paper.png')

/* ---------- 4. 重开 → 选区落在粗体内 → Ctrl+B 取消加粗 ---------- */

await firstBullet.click()
await page.waitForTimeout(500)
log(
  (await ie.inputValue()) === `**${raw0.slice(0, 4)}**${raw0.slice(4)}`,
  '重新打开显示的是原始串（含 **）',
)

// 粗体内容位于 [2, 6)：Home 后右移 2 步落到内容起点，再扩展 4 步正好框住「主导公司」
await ie.press('Home')
for (let i = 0; i < 2; i += 1) await ie.press('ArrowRight')
for (let i = 0; i < 4; i += 1) await ie.press('Shift+ArrowRight')
await page.waitForTimeout(300)

log((await btnLabel()) === '取消加粗', '选区落在粗体内容内，按钮显示「取消加粗」')

await ie.press('Control+b')
await page.waitForTimeout(300)
log((await ie.inputValue()) === raw0, 'Ctrl+B 取消加粗，草稿回到原始串')

await ie.press('Control+Enter')
await page.waitForTimeout(600)

const paperAfterUnbold = await page.evaluate(
  () => !document.querySelector('.paper li[data-field="bulletText"] strong'),
)
log(paperAfterUnbold, '提交后纸面的 <strong> 消失（取消加粗生效）')

/* ---------- 5. 不可加粗字段：页头姓名没有按钮，Ctrl+B 也写不进星号 ---------- */

await page.locator('.paper [data-field="name"]').first().click()
await page.waitForTimeout(500)

const nameInput = page.locator('.ie-input')
log((await nameInput.count()) === 1, '单击姓名打开就地编辑')
log(
  (await page.locator('.ie-bold').count()) === 0,
  '姓名字段不提供加粗按钮（模板直插渲染，不解析标记）',
)

await nameInput.press('Control+a')
await nameInput.press('Control+b')
await page.waitForTimeout(200)
log(!(await nameInput.inputValue()).includes('**'), '姓名字段里 Ctrl+B 也不会写入星号')

await nameInput.press('Escape')
await page.waitForTimeout(300)

console.log('')
console.log(`加粗验证：${pass}/${pass + failed.length} 通过`)
if (errors.length) {
  console.log(`控制台/运行时错误（${errors.length} 条）：`)
  for (const e of errors.slice(0, 6)) console.log(`  · ${e}`)
} else {
  console.log('控制台/运行时错误：无')
}

await browser.close()
process.exit(failed.length ? 1 : 0)
